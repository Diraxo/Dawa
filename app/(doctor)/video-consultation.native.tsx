import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ScreenCapture from 'expo-screen-capture'
import * as Notifications from 'expo-notifications'
import * as Haptics from 'expo-haptics'
import { Audio } from 'expo-av'

// Hardcoded to avoid requiring the native module at load time (TurboModule Proxy crashes at startup)
const ClientRoleBroadcaster = 1  // ClientRoleType.ClientRoleBroadcaster
const VideoSourceCamera = 0       // VideoSourceType.VideoSourceCamera
// Lazily require react-native-agora — wrapped in try/catch since the TurboModule
// isn't available in Expo Go (matches the stream-chat-expo require below).
let RtcSurfaceView: any = null
try {
  RtcSurfaceView = require('react-native-agora').RtcSurfaceView
} catch {}

// Lazily require stream-chat-expo — wrapped in try/catch since the TurboModule
// isn't available in Expo Go (matches the phone-consultation screens' pattern).
let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
try {
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
} catch {}

import { EndConsultationSheet } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { streamClient } from '@/lib/stream'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useUserPhotoRealtime } from '@/hooks/useUserPhotoRealtime'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { logger } from '@/lib/logger'

const GRACE_PERIOD_MS = 90_000
const CONNECTION_TIMEOUT_MS = 90_000
const MUTE_DEBOUNCE_MS = 4_000

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

export default function DoctorVideoConsultationScreen() {
  const { patientName, consultationId, resumeElapsed } = useLocalSearchParams<{
    patientName?: string
    consultationId?: string
    resumeElapsed?: string
  }>()
  const router = useRouter()
  const { userId } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, setConnectionStatus } = useActiveConsultationStore()
  const displayName = patientName ?? 'Patient'

  ScreenCapture.usePreventScreenCapture()

  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [localError, setLocalError] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false)
  const [tokenRetryKey, setTokenRetryKey] = useState(0)
  const [reconnectCountdown, setReconnectCountdown] = useState(90)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [networkQuality, setNetworkQuality] = useState<0|1|2|3|4|5|6>(0)
  const [showInfoSheet, setShowInfoSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const channelName = consultationId ?? `consult-demo`
  const localUid = useMemo(() => userId ? uidFromString(userId) : 2, [userId])
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null

  // Keeps the always-current mute intent so it can be re-applied the instant
  // a new engine joins (retry/reconnect), without waiting on React state.
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  const toggleMute = () => {
    setMuted(m => {
      const next = !m
      setPersistedMute(consultationId, next)
      return next
    })
  }

  // Load any previously-chosen mute state for this consultation before the
  // first join, so a refresh/app-restart mid-call resumes muted.
  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    getPersistedMute(consultationId).then(persisted => {
      if (!cancelled && persisted) setMuted(true)
    })
    return () => { cancelled = true }
  }, [consultationId])

  // Patient identity photo — fetched once, then kept live via Realtime so an
  // upload/delete from the patient's own profile reflects here immediately.
  const [patientUserId, setPatientUserId] = useState<string | null>(null)
  const [patientInitialPhotoUrl, setPatientInitialPhotoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    supabase
      .from('consultations')
      .select('patient:users!patient_id(id, profile_photo_url)')
      .eq('id', consultationId)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        const patient = (data as any)?.patient
        setPatientUserId(patient?.id ?? null)
        setPatientInitialPhotoUrl(patient?.profile_photo_url ?? null)
      })
    return () => { cancelled = true }
  }, [consultationId])
  const patientPhotoUrl = useUserPhotoRealtime(patientUserId, patientInitialPhotoUrl)

  // Single source of truth for call phase/timer — derived from the DB row via
  // Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: channelName, role: 'doctor', localAgoraReconnecting: isReconnecting })
  const phaseRef = useRef(state.phase)
  useEffect(() => { phaseRef.current = state.phase }, [state.phase])
  const seconds = state.elapsedSeconds ?? 0
  const startedAtIso = state.startedAtIso
  const callStatus: CallStatus = localError
    ? 'error'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? 'connected'
    : state.phase === 'waiting_for_patient'
    ? 'waiting'
    : 'connecting'

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userOfflineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endedHandledRef = useRef(false)
  const chatSlide = useRef(new Animated.Value(0)).current
  const chatOpenRef = useRef(false)

  // Sends a heartbeat UPDATE to consultations.last_heartbeat_at every 30s
  // while connected, so the server-side stale-consultation cleanup can tell
  // a crashed mobile call apart from a genuinely long-running one.
  useHeartbeat(consultationId, callStatus === 'connected')

  // Once the DB-derived phase reaches 'ended' — patient declined/missed the
  // call, or it completed/ended abnormally on some other device/session —
  // release Agora resources and navigate away exactly once.
  useEffect(() => {
    if (state.phase !== 'ended' || endedHandledRef.current) return
    endedHandledRef.current = true
    try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel() } catch {}
    releaseAgoraEngine()
    setActive(null)
    if (state.rawStatus === 'call_declined') {
      Alert.alert('Call Declined', 'The patient has declined the call.', [
        { text: 'OK', onPress: () => router.replace('/(doctor)/(tabs)/consultations' as any) },
      ])
    } else if (state.rawStatus === 'missed') {
      Alert.alert('Missed Call', 'The patient did not answer the call.', [
        { text: 'OK', onPress: () => router.replace('/(doctor)/(tabs)/consultations' as any) },
      ])
    } else {
      Alert.alert('Call Ended', 'The consultation has ended.', [
        { text: 'OK', onPress: () => router.replace('/(doctor)/(tabs)/consultations' as any) },
      ])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // ── Store sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!consultationId) return
    setActive({
      consultationId,
      type: 'video',
      otherPersonName: displayName,
      role: 'doctor',
      elapsedSeconds: seconds,
      status: 'active',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  useEffect(() => { updateElapsed(seconds) }, [seconds])

  useEffect(() => {
    setConnectionStatus(callStatus === 'reconnecting' ? 'reconnecting' : 'active')
  }, [callStatus])

  // ── Background/foreground: notification + camera lifecycle ───────────────
  // Camera keeps publishing if left untouched while backgrounded, which
  // risks the OS suspending/killing the app and can leave the preview
  // surface stuck on return — release it on background, reacquire on
  // foreground (respecting whatever camera-off state the user had chosen).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const inCall = callStatus === 'connected' || callStatus === 'reconnecting' || callStatus === 'waiting'
      if (nextState === 'background' || nextState === 'inactive') {
        if (inCall) {
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'Ongoing Video Consultation',
              body: `Tap to return to your video call with ${displayName}`,
              sound: 'default',
              data: {
                screen: 'consultation',
                consultationId,
                consultationType: 'video',
                patientName: displayName,
              },
            },
            trigger: null,
          }).catch(() => {})
          try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.muteLocalVideoStream(true) } catch {}
        }
      } else if (nextState === 'active' && inCall) {
        try {
          getAgoraEngine()?.startPreview()
          getAgoraEngine()?.muteLocalVideoStream(camOff)
        } catch {}
      }
    })
    return () => sub.remove()
  }, [callStatus, consultationId, displayName, camOff])

  // ── Fetch Agora token ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!channelName) return
    setTokenFetchFailed(false)
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(token => { setAgoraToken(token); setTokenFetchFailed(false) })
        .catch((err) => { logger.error('[Agora] Doctor video token fetch failed:', err); setTokenFetchFailed(true) })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, localUid, tokenRetryKey])

  // ── Agora engine ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agoraReady) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try {
      engine = getAgoraEngine()
    } catch {
      return
    }

    const clearGracePeriod = () => {
      if (gracePeriodRef.current) { clearTimeout(gracePeriodRef.current); gracePeriodRef.current = null }
      if (gracePeriodCountdownRef.current) { clearInterval(gracePeriodCountdownRef.current); gracePeriodCountdownRef.current = null }
    }

    const startGracePeriod = () => {
      clearGracePeriod()
      setReconnectCountdown(90)

      gracePeriodCountdownRef.current = setInterval(() => {
        setReconnectCountdown(c => {
          if (c <= 1) { clearInterval(gracePeriodCountdownRef.current!); gracePeriodCountdownRef.current = null; return 0 }
          return c - 1
        })
      }, 1000)

      gracePeriodRef.current = setTimeout(async () => {
        if (!mounted) return
        clearGracePeriod()
        logger.warn('[Video][Doctor] Grace period expired — marking ended_abnormally')
        try {
          await supabase
            .from('consultations')
            .update({ status: 'ended_abnormally' })
            .eq('id', channelName)
            .eq('status', 'in_progress')
        } catch {}
        if (mounted) {
          setActive(null)
          router.replace('/(doctor)/(tabs)/consultations')
        }
      }, GRACE_PERIOD_MS)
    }

    const handler = {
      onJoinChannelSuccess: (connection: any) => {
        logger.log(`[Video][Doctor][${Date.now()}] onJoinChannelSuccess channel:${connection?.channelId} uid:${connection?.localUid}`)
        // Re-apply the user's chosen mute state to the (possibly brand-new,
        // post-retry) engine — a fresh join always defaults to unmuted.
        try { engine?.muteLocalAudioStream(mutedRef.current) } catch {}
        // Our own join+publish succeeded (joinChannel publishes mic+camera
        // directly for RTC engine calls) — report only our own milestone. The
        // DB trigger flips status/started_at once the patient's own write
        // lands too; both clients learn of it from the same row update.
        state.markSelfConnected()
        // Clear the connecting-stuck timeout; join succeeded
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      },
      onUserJoined: (_conn: any, uid: number) => {
        logger.log(`[Video][Doctor][${Date.now()}] onUserJoined remoteUid:${uid}`)
        if (!mounted) return
        remoteUidRef.current = uid
        setRemoteUid(uid)
        setIsReconnecting(false)
        setRemoteMuted(false)
        clearGracePeriod()
        if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      },
      onUserOffline: (_conn: any, uid: number, reason: number) => {
        logger.log(`[Video][Doctor][${Date.now()}] onUserOffline uid:${uid} reason:${reason}`)
        if (!mounted || uid !== remoteUidRef.current) return
        // Debounce: 4s window so a mute event can cancel the offline transition
        if (userOfflineDebounceRef.current) clearTimeout(userOfflineDebounceRef.current)
        userOfflineDebounceRef.current = setTimeout(() => {
          userOfflineDebounceRef.current = null
          if (!mounted) return
          remoteUidRef.current = null
          setRemoteUid(null)
          setIsReconnecting(true)
          startGracePeriod()
        }, MUTE_DEBOUNCE_MS)
      },
      onRemoteAudioStateChanged: (_conn: any, uid: number, _state: number, reason: number) => {
        if (!mounted) return
        // reason 5 = REMOTE_MUTED — cancel any pending offline debounce so mute isn't misread as disconnect
        if (reason === 5) {
          setRemoteMuted(true)
          if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
        } else if (reason === 6) {
          setRemoteMuted(false)
        }
      },
      onNetworkQuality: (_uid: any, txQuality: number) => {
        if (mounted) setNetworkQuality(txQuality as any)
      },
      onConnectionStateChanged: (_conn: any, state: number, reason: number) => {
        logger.log(`[Video][Doctor][${Date.now()}] connectionStateChanged state:${state} reason:${reason}`)
        // state 4 = RECONNECTING, state 5 = FAILED. Without this, a network
        // blip on THIS device is invisible locally (only the peer's
        // onUserOffline would show it), so the two sides can disagree about
        // whether the call is currently healthy.
        if (state === 4 && mounted) { setIsReconnecting(true) }
        if (state === 3 && mounted) { setIsReconnecting(false) }
        if (state === 5 && mounted) { logger.error('[Video][Doctor] Connection FAILED'); setLocalError(true) }
        if (reason === 19 && mounted) {
          Alert.alert('Session Ended', 'You joined this consultation from another device.')
        }
      },
      onError: (errorCode: number, msg: string) => {
        logger.error(`[Video][Doctor][${Date.now()}] Agora error code:${errorCode} msg:${msg}`)
        if (mounted) setLocalError(true)
      },
      onTokenPrivilegeWillExpire: (_conn: any, _token: string) => {
        logger.log(`[Video][Doctor][${Date.now()}] Token privilege will expire — renewing`)
        getToken().then(async tok => {
          if (!tok) return
          try {
            const refreshed = await fetchAgoraToken(channelName, localUid, tok)
            engine?.renewToken(refreshed)
            logger.log('[Video][Doctor] Token renewed')
          } catch (e) { logger.error('[Video][Doctor] Token renewal failed:', e) }
        })
      },
    }

    engine.registerEventHandler(handler)

    async function startCall() {
      try {
        const { status } = await Audio.requestPermissionsAsync()
        if (!mounted) return
        if (status !== 'granted') { setLocalError(true); return }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
        })
        if (!mounted) return

        engine!.enableAudio()
        engine!.enableVideo()
        engine!.setEnableSpeakerphone(true)
        engine!.startPreview()
        engine!.setCloudProxy(3) // Force UDP cloud proxy — fixes restrictive networks

        logger.log(`[Video][Doctor][${Date.now()}] joinChannel → channel:${channelName} uid:${localUid} tokenLen:${agoraToken?.length ?? 0}`)
        const code = engine!.joinChannel(agoraToken ?? '', channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: true,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        })
        logger.log(`[Video][Doctor][${Date.now()}] joinChannel returned code:${code}`)
        if (typeof code === 'number' && code < 0) {
          logger.error('[Video][Doctor] joinChannel rejected code:', code)
          if (mounted) setLocalError(true)
          return
        }

        // Timeout covers BOTH 'connecting' (join never completed) and
        // 'waiting' (joined, but patient never appeared within 90s).
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            logger.error(`[Video][Doctor][${Date.now()}] Connection timeout — stuck in phase:${phaseRef.current}`)
            setLocalError(true)
          }
        }, CONNECTION_TIMEOUT_MS)
      } catch (e) {
        logger.error('[Video][Doctor] startCall error:', e)
        if (mounted) setLocalError(true)
      }
    }

    startCall()

    return () => {
      mounted = false
      if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
      clearGracePeriod()
      engine?.unregisterEventHandler(handler)
      engine?.stopPreview()
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  }, [agoraReady, channelName, localUid])

  // Sync mute
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalAudioStream(muted) } catch {}
  }, [muted, agoraReady])

  // Sync camera
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalVideoStream(camOff) } catch {}
  }, [camOff, agoraReady])

  // Sync speaker
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().setEnableSpeakerphone(speakerOn) } catch {}
  }, [speakerOn, agoraReady])

  // ── Chat helpers ───────────────────────────────────────────────────────────
  // Watch the Stream channel as soon as the call starts, not gated behind the
  // first chat-icon tap — otherwise the message.new listener below doesn't
  // exist yet when the peer's first message arrives and the unread badge
  // misses it.
  useEffect(() => {
    if (!activeChannel && consultationId && Chat) {
      let cancelled = false
      setChannelLoading(true)
      ;(async () => {
        try {
          // Pass members so watch() self-heals channel membership instead of
          // relying solely on membership set up elsewhere at accept-time.
          const { data } = await supabase
            .from('consultations')
            .select('patient:users!patient_id(clerk_id)')
            .eq('id', consultationId)
            .single()
          const patientClerkId = (data as any)?.patient?.clerk_id as string | undefined
          const members = userId && patientClerkId ? [userId, patientClerkId] : undefined
          const ch = streamClient.channel('messaging', consultationId, members ? { members } : undefined)
          await ch.watch()
          if (cancelled) return
          setActiveChannel(ch)
          // Seed from Stream's own persisted unread state (not just messages
          // that arrive after this listener attaches) so a badge survives a
          // remount/refresh instead of always starting back at 0.
          if (chatOpenRef.current) {
            ch.markRead().catch(() => {})
          } else {
            setUnreadCount(ch.countUnread())
          }
          ch.on('message.new', () => {
            if (!chatOpenRef.current) setUnreadCount(c => c + 1)
            else ch.markRead().catch(() => {})
          })
        } catch (err) {
          logger.error('[DoctorVideoChat] watch failed:', err)
        } finally {
          if (!cancelled) setChannelLoading(false)
        }
      })()
      return () => { cancelled = true }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, userId])

  const openChat = () => {
    setUnreadCount(0)
    chatOpenRef.current = true
    activeChannel?.markRead().catch(() => {})
    Animated.spring(chatSlide, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start()
    setChatOpen(true)
  }
  const closeChat = () => {
    chatOpenRef.current = false
    Animated.timing(chatSlide, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setChatOpen(false))
  }
  const chatSlideY = chatSlide.interpolate({ inputRange: [0, 1], outputRange: [700, 0] })

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleEndSubmit = async (data: any) => {
    try {
      const token = await getToken()
      if (token && consultationId) {
        const client = getAuthClient(token)
        const { error: summaryError } = await client.from('consultation_summaries').upsert({
          consultation_id: consultationId,
          chief_complaint: data.chiefComplaint,
          diagnosis: data.diagnosis,
          prescription: data.prescriptions?.length > 0 ? JSON.stringify(data.prescriptions) : null,
          followup_recommendation: data.followUp || null,
          referral_needed: data.referralNeeded,
          referral_specialty: data.referralNeeded && data.referralSpecialty?.trim() ? data.referralSpecialty.trim() : null,
        }, { onConflict: 'consultation_id' })
        if (summaryError) {
          logger.error('[Video][Doctor] save summary failed:', summaryError)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
        const { error: statusError } = await client
          .from('consultations')
          .update({ status: 'completed', ended_at: new Date().toISOString(), duration_minutes: Math.ceil(seconds / 60) })
          .eq('id', consultationId)
        if (statusError) {
          logger.error('[Video][Doctor] mark completed failed:', statusError)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
        // Stream channel locking is now handled server-side by a DB trigger
        // (on_consultation_change → freeze-consultation-channel Edge Function)
        // the instant status flips to 'completed' above — no client call needed.
      }
    } catch (err) {
      logger.error('[Video][Doctor] save summary failed:', err)
      Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
      return
    }
    try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
    clearPersistedMute(consultationId)
    setShowEndSheet(false)
    setActive(null)
    router.replace('/(doctor)/(tabs)/consultations' as any)
  }

  const handleEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    const isCallActive = callStatus === 'connected' || callStatus === 'reconnecting'
    if (!isCallActive) {
      // In 'waiting' (ringing) or 'connecting' — cancel the outgoing call
      Alert.alert('Cancel Call', 'Cancel this outgoing call?', [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Cancel Call', style: 'destructive',
          onPress: () => {
            try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
            setActive(null)
            router.replace('/(doctor)/(tabs)/consultations' as any)
          },
        },
      ])
      return
    }
    setShowEndSheet(true)
  }

  const isConnecting = callStatus === 'connecting'
  const netLabel = networkQuality <= 2 ? 'Excellent' : networkQuality <= 4 ? 'Good' : networkQuality > 0 ? 'Poor' : null

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Patient video (full screen) */}
      <View style={styles.mainVideo}>
        {agoraReady && remoteUid && RtcSurfaceView ? (
          <RtcSurfaceView canvas={{ uid: remoteUid }} style={styles.fullFill} />
        ) : (
          <View style={styles.patientVideoPlaceholder}>
            {patientPhotoUrl ? (
              <Image source={{ uri: patientPhotoUrl }} style={styles.patientVideoPlaceholderImage} />
            ) : (
              <Ionicons name="person" size={80} color="rgba(255,255,255,0.15)" />
            )}
            <Text style={styles.patientVideoName}>{displayName}</Text>
            {tokenFetchFailed ? (
              <Pressable
                onPress={() => setTokenRetryKey(k => k + 1)}
                style={{ marginTop: 4, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}
              >
                <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#FCA5A5' }}>Connection failed — tap to retry</Text>
              </Pressable>
            ) : (
              <Text style={styles.patientVideoSub}>
                {callStatus === 'reconnecting' ? 'Patient reconnecting…' :
                 callStatus === 'waiting' ? 'Waiting for patient…' : 'Connecting…'}
              </Text>
            )}
          </View>
        )}

        {/* Timer + network quality overlay */}
        <View style={styles.timerOverlay}>
          <View style={[styles.timerBadge, callStatus === 'reconnecting' && styles.timerBadgeWarning]}>
            <View style={[styles.liveDot, callStatus === 'reconnecting' && styles.liveDotWarning]} />
            <Text style={styles.timerText}>{callStatus === 'connected' || callStatus === 'reconnecting' ? formatTime(seconds) : '--:--'}</Text>
          </View>
          {netLabel && callStatus === 'connected' && (
            <View style={[styles.netQualityChip, netLabel === 'Poor' && styles.netQualityChipPoor]}>
              <Text style={styles.netQualityText}>{netLabel}</Text>
            </View>
          )}
        </View>

        {/* Reconnect overlay */}
        {callStatus === 'reconnecting' && (
          <View style={styles.reconnectOverlay}>
            <ActivityIndicator size="small" color="#FBBF24" style={{ marginRight: 8 }} />
            <Text style={styles.reconnectText}>Reconnecting…</Text>
          </View>
        )}

        {/* Remote muted badge */}
        {remoteMuted && callStatus === 'connected' && (
          <View style={styles.remoteMutedBadge}>
            <Ionicons name="mic-off" size={13} color="#FDE68A" />
            <Text style={styles.remoteMutedText}>Patient muted</Text>
          </View>
        )}

        {/* Doctor self-view (top-right) */}
        <View style={styles.selfView}>
          {agoraReady && !camOff && RtcSurfaceView ? (
            <RtcSurfaceView canvas={{ uid: 0, sourceType: VideoSourceCamera }} style={styles.selfViewFill} />
          ) : (
            <View style={styles.selfViewOff}>
              <Ionicons name={camOff ? 'videocam-off' : 'person'} size={22} color="rgba(255,255,255,0.5)" />
            </View>
          )}
          <Text style={styles.selfLabel}>You</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <DrCtrlBtn
            icon={muted ? 'mic-off' : 'mic'}
            label={muted ? 'Unmute' : 'Mute'}
            active={muted}
            disabled={isConnecting}
            onPress={toggleMute}
          />

          <DrCtrlBtn
            icon={speakerOn ? 'volume-high' : 'volume-medium'}
            label="Speaker"
            active={speakerOn}
            disabled={isConnecting}
            onPress={() => setSpeakerOn(s => !s)}
          />

          <DrCtrlBtn
            icon="camera-reverse"
            label="Flip"
            disabled={isConnecting}
            onPress={() => {
              const engine = getAgoraEngine()
              try { engine?.switchCamera() } catch {}
            }}
          />

          <Pressable style={styles.endBtn} onPress={handleEnd}>
            <Ionicons name="call" size={24} color={colors.mistWhite} />
          </Pressable>

          <DrCtrlBtn
            icon={camOff ? 'videocam-off' : 'videocam'}
            label={camOff ? 'Cam On' : 'Video'}
            active={camOff}
            disabled={isConnecting}
            onPress={() => setCamOff(c => !c)}
          />

          <View>
            <DrCtrlBtn
              icon="chatbubble-ellipses"
              label="Chat"
              active={chatOpen}
              disabled={isConnecting}
              onPress={chatOpen ? closeChat : openChat}
            />
            {unreadCount > 0 && !chatOpen && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>

          <DrCtrlBtn
            icon="information-circle-outline"
            label="Info"
            disabled={isConnecting}
            onPress={() => setShowInfoSheet(true)}
          />
        </View>
      </View>

      {/* Info bottom sheet */}
      {showInfoSheet && (
        <Pressable style={styles.infoSheetBackdrop} onPress={() => setShowInfoSheet(false)}>
          <Pressable style={styles.infoSheet} onPress={e => e.stopPropagation()}>
            <View style={styles.infoSheetHandle} />
            <View style={styles.infoSheetHeader}>
              <Text style={styles.infoSheetTitle}>Call Information</Text>
              <Pressable onPress={() => setShowInfoSheet(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </Pressable>
            </View>
            <View style={styles.infoSheetBody}>
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Patient</Text>
                <Text style={styles.infoSheetValue}>{displayName}</Text>
              </View>
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Consultation ID</Text>
                <Text style={styles.infoSheetValue} numberOfLines={1}>{consultationId ?? '—'}</Text>
              </View>
              {startedAtIso && (
                <View style={styles.infoSheetRow}>
                  <Text style={styles.infoSheetLabel}>Started at</Text>
                  <Text style={styles.infoSheetValue}>{new Date(startedAtIso).toLocaleTimeString()}</Text>
                </View>
              )}
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Duration</Text>
                <Text style={styles.infoSheetValue}>{formatTime(seconds)}</Text>
              </View>
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Network</Text>
                <Text style={[styles.infoSheetValue, netLabel === 'Poor' && { color: '#F87171' }]}>{netLabel ?? 'Measuring…'}</Text>
              </View>
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Encryption</Text>
                <Text style={styles.infoSheetValue}>AES-128</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      )}

      {/* Chat bottom sheet */}
      {chatOpen && (
        <Animated.View style={[styles.chatPanel, { transform: [{ translateY: chatSlideY }] }]}>
          <View style={styles.panelHandle} />
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>In-call chat</Text>
            <View style={styles.callContinues}>
              <Ionicons name="videocam" size={13} color={colors.tealGreen} />
              <Text style={styles.callContinuesText}>Call continues</Text>
            </View>
            <Pressable onPress={closeChat} hitSlop={12}>
              <Ionicons name="chevron-down" size={22} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          {!Chat ? (
            <View style={styles.panelEmpty}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color="rgba(255,255,255,0.2)" />
              <Text style={styles.panelEmptyText}>Chat unavailable in Expo Go</Text>
              <Text style={styles.panelEmptyHint}>Use a development build to enable chat</Text>
            </View>
          ) : channelLoading || !activeChannel ? (
            <View style={styles.panelEmpty}>
              <ActivityIndicator color={colors.tealGreen} size="large" />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Chat client={streamClient}>
                <ChannelView channel={activeChannel}>
                  <MessageList />
                  <MessageComposer />
                </ChannelView>
              </Chat>
            </View>
          )}
        </Animated.View>
      )}
    </SafeAreaView>
  )
}

function DrCtrlBtn({ icon, label, active = false, disabled = false, onPress }: {
  icon: string; label: string; active?: boolean; disabled?: boolean; onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.ctrlBtn,
        active && styles.ctrlBtnActive,
        disabled && styles.ctrlBtnDisabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress()
      }}
    >
      <Ionicons
        name={icon as any}
        size={20}
        color={disabled ? 'rgba(0,0,0,0.2)' : active ? colors.mistWhite : colors.inkBlack}
      />
      <Text style={[styles.controlLabel, active && styles.controlLabelActive, disabled && styles.controlLabelDisabled]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },
  fullFill: { flex: 1 },

  mainVideo: { flex: 1, position: 'relative' },
  patientVideoPlaceholder: { flex: 1, backgroundColor: '#0D1A3A', alignItems: 'center', justifyContent: 'center', gap: 12 },
  patientVideoPlaceholderImage: { width: 120, height: 120, borderRadius: 60 },
  patientVideoName: { fontFamily: fonts.bold, fontSize: 22, color: 'rgba(255,255,255,0.6)' },
  patientVideoSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.3)' },

  timerOverlay: { position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center', gap: 6 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  timerBadgeWarning: { backgroundColor: 'rgba(251,191,36,0.2)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveDotWarning: { backgroundColor: '#FBBF24' },
  timerText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  netQualityChip: { backgroundColor: 'rgba(34,197,94,0.2)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)' },
  netQualityChipPoor: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)' },
  netQualityText: { fontFamily: fonts.medium, fontSize: 11, color: colors.mistWhite },

  reconnectOverlay: {
    position: 'absolute', bottom: 100, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  reconnectText: { fontFamily: fonts.medium, fontSize: 13, color: '#FDE68A' },

  remoteMutedBadge: { position: 'absolute', top: 80, left: 0, right: 0, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 },
  remoteMutedText: { fontFamily: fonts.medium, fontSize: 12, color: '#FDE68A' },

  selfView: { position: 'absolute', top: 70, right: 16, alignItems: 'center', gap: 4 },
  selfViewFill: { width: 90, height: 120, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  selfViewOff: { width: 90, height: 120, borderRadius: 14, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)' },
  selfLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.6)' },

  controls: { paddingHorizontal: 12, paddingBottom: 32, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ctrlBtn: { alignItems: 'center', gap: 5, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  ctrlBtnActive: { backgroundColor: colors.careBlue },
  ctrlBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)' },
  controlLabel: { fontFamily: fonts.medium, fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  controlLabelActive: { color: colors.mistWhite },
  controlLabelDisabled: { color: 'rgba(255,255,255,0.25)' },
  endBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', shadowColor: colors.error, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6, transform: [{ rotate: '135deg' }] },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#070E27',
  },
  unreadBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },

  chatPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '64%',
    backgroundColor: '#0D1A3A',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 8, elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5, shadowRadius: 16,
  },
  panelHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginBottom: 8,
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  panelTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.mistWhite, flex: 1 },
  callContinues: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 12 },
  callContinuesText: { fontFamily: fonts.medium, fontSize: 12, color: colors.tealGreen },
  panelEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  panelEmptyText: { fontFamily: fonts.semiBold, fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  panelEmptyHint: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.35)' },

  infoSheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', zIndex: 50 },
  infoSheet: { backgroundColor: '#0D1A3A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  infoSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 },
  infoSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  infoSheetTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.mistWhite },
  infoSheetBody: { gap: 12 },
  infoSheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  infoSheetLabel: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  infoSheetValue: { fontFamily: fonts.medium, fontSize: 13, color: colors.mistWhite, maxWidth: '55%', textAlign: 'right' },
})
