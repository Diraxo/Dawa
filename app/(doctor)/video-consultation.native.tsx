import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
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

// Only used here to gate watchConsultationChannel() on availability — the
// actual chat UI now lives entirely in the shared InCallChatPanel.
let Chat: any = null
try {
  Chat = require('stream-chat-expo').Chat
} catch {}

import { EndConsultationSheet } from '@/components/doctor/EndConsultationSheet'
import { CallInfoPanel } from '@/components/consultation/CallInfoPanel'
import { InCallChatPanel } from '@/components/consultation/InCallChatPanel'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { streamClient, watchConsultationChannel } from '@/lib/stream'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { logger } from '@/lib/logger'
import { localizeNotificationPhoto } from '@/lib/notificationPhoto'

const GRACE_PERIOD_MS = 90_000
const CONNECTION_TIMEOUT_MS = 90_000
const MUTE_DEBOUNCE_MS = 4_000

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

export default function DoctorVideoConsultationScreen() {
  const insets = useSafeAreaInsets()
  const { patientName, consultationId, resumeElapsed } = useLocalSearchParams<{
    patientName?: string
    consultationId?: string
    resumeElapsed?: string
  }>()
  const router = useRouter()
  const { userId, isStreamConnected } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, setConnectionStatus } = useActiveConsultationStore()

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

  // Keeps the always-current mute intent so it can be re-applied the instant
  // a new engine joins (retry/reconnect), without waiting on React state.
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  // Cloud proxy (forced UDP relay) adds real latency/quality cost and should
  // only be paid on networks that actually need it — start without it, and
  // only fall back to it on the next join attempt if this one never
  // connects.
  const proxyFallbackRef = useRef(false)
  const toggleMute = () => {
    setMuted(m => {
      const next = !m
      setPersistedMute(consultationId, next)
      return next
    })
  }

  // Load any previously-chosen mute state for this consultation before the
  // first join, so a refresh/app-restart mid-call resumes muted. The join
  // effect below waits on `muteLoaded` so the very first joinChannel already
  // publishes with the correct mute state.
  const [muteLoaded, setMuteLoaded] = useState(false)
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null && muteLoaded
  useEffect(() => {
    if (!consultationId) { setMuteLoaded(true); return }
    let cancelled = false
    getPersistedMute(consultationId).then(persisted => {
      if (cancelled) return
      if (persisted) { mutedRef.current = true; setMuted(true) }
      setMuteLoaded(true)
    })
    return () => { cancelled = true }
  }, [consultationId])

  // Patient identity (name + photo) — fetched once, then kept live via
  // Realtime so a rename/upload/delete from the patient's own profile
  // reflects here immediately, no refresh required.
  const [patientUserId, setPatientUserId] = useState<string | null>(null)
  const [patientInitialName, setPatientInitialName] = useState<string | null>(null)
  const [patientInitialPhotoUrl, setPatientInitialPhotoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    supabase
      .from('consultations')
      .select('patient:users!patient_id(id, full_name, profile_photo_url)')
      .eq('id', consultationId)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        const patient = (data as any)?.patient
        setPatientUserId(patient?.id ?? null)
        setPatientInitialName(patient?.full_name ?? null)
        setPatientInitialPhotoUrl(patient?.profile_photo_url ?? null)
      })
    return () => { cancelled = true }
  }, [consultationId])
  const { name: livePatientName, photoUrl: patientPhotoUrl } = useUserProfileRealtime(
    patientUserId,
    patientInitialName ?? patientName ?? null,
    patientInitialPhotoUrl
  )
  const displayName = livePatientName ?? patientName ?? 'Patient'

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
      otherPersonPhotoUrl: patientPhotoUrl,
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
    const sub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const inCall = callStatus === 'connected' || callStatus === 'reconnecting' || callStatus === 'waiting'
      if (nextState === 'background' || nextState === 'inactive') {
        if (inCall) {
          // Android gets the persistent, real-timer Notifee notification from
          // useOngoingConsultationNotification instead (driven globally off
          // the active-consultation store) — only iOS needs this one-shot.
          if (Platform.OS !== 'android') {
            const localPhotoUri = await localizeNotificationPhoto(patientPhotoUrl)
            Notifications.scheduleNotificationAsync({
              content: {
                title: `Call with ${displayName}`,
                body: `Tap to return to your video call with ${displayName}`,
                sound: 'default',
                data: {
                  screen: 'consultation',
                  consultationId,
                  consultationType: 'video',
                  patientName: displayName,
                  patientId: patientUserId ?? '',
                  patientPhotoUrl: patientPhotoUrl ?? '',
                },
                ...(localPhotoUri ? { attachments: [{ identifier: 'photo', url: localPhotoUri, type: 'image' }] } : {}),
              },
              trigger: null,
            }).catch(() => {})
          }
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
  }, [callStatus, consultationId, displayName, camOff, patientUserId, patientPhotoUrl])

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
        if (state === 5 && mounted) { logger.error('[Video][Doctor] Connection FAILED'); proxyFallbackRef.current = true; setLocalError(true) }
        if (reason === 19 && mounted) {
          Alert.alert('Session Ended', 'You joined this consultation from another device.')
        }
      },
      onError: (errorCode: number, msg: string) => {
        logger.error(`[Video][Doctor][${Date.now()}] Agora error code:${errorCode} msg:${msg}`)
        proxyFallbackRef.current = true
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
        // AudioProfileDefault (0) + AudioScenarioMeeting (8) — tuned for a
        // 1:1 voice-centric consultation (vs. the SDK's generic default).
        try { engine!.setAudioProfile(0, 8) } catch {}
        engine!.muteLocalAudioStream(mutedRef.current)
        engine!.setEnableSpeakerphone(true)
        engine!.startPreview()
        if (proxyFallbackRef.current) engine!.setCloudProxy(3)

        logger.log(`[Video][Doctor][${Date.now()}] joinChannel → channel:${channelName} uid:${localUid} tokenLen:${agoraToken?.length ?? 0} proxy:${proxyFallbackRef.current}`)
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
          proxyFallbackRef.current = true
          if (mounted) setLocalError(true)
          return
        }

        // Timeout covers BOTH 'connecting' (join never completed) and
        // 'waiting' (joined, but patient never appeared within 90s).
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            logger.error(`[Video][Doctor][${Date.now()}] Connection timeout — stuck in phase:${phaseRef.current}`)
            proxyFallbackRef.current = true
            setLocalError(true)
          }
        }, CONNECTION_TIMEOUT_MS)
      } catch (e) {
        logger.error('[Video][Doctor] startCall error:', e)
        proxyFallbackRef.current = true
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
    // streamClient.channel() throws "Call connectUser..." until the Stream
    // socket handshake (kicked off by useStreamConnection) finishes — userId
    // is set into the auth store slightly before that resolves.
    if (!activeChannel && consultationId && Chat && isStreamConnected) {
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
          const ch = await watchConsultationChannel(consultationId, members)
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
  }, [consultationId, userId, isStreamConnected])

  const openChat = () => {
    setUnreadCount(0)
    chatOpenRef.current = true
    activeChannel?.markRead().catch(() => {})
    setChatOpen(true)
  }
  const closeChat = () => {
    chatOpenRef.current = false
    setChatOpen(false)
  }

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
    <SafeAreaView style={styles.safe} edges={['top']}>
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
            <Text style={styles.timerText}>
              {callStatus === 'connected' ? formatTime(seconds) : callStatus === 'reconnecting' ? 'Reconnecting…' : '--:--'}
            </Text>
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
      <View style={[styles.controls, { paddingBottom: 12 + insets.bottom }]}>
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

          <Pressable style={styles.endBtn} onPress={handleEnd}>
            <Ionicons name="call" size={24} color={colors.mistWhite} />
          </Pressable>
        </View>
      </View>

      {/* Info bottom sheet */}
      <CallInfoPanel
        visible={showInfoSheet}
        onClose={() => setShowInfoSheet(false)}
        consultationId={consultationId}
        consultationType="video"
        counterpartLabel="Patient"
        counterpartName={displayName}
        counterpartPhotoUrl={patientPhotoUrl}
        startedAtIso={startedAtIso}
        elapsedSeconds={seconds}
        networkQuality={networkQuality}
      />

      {/* Chat bottom sheet */}
      <InCallChatPanel
        visible={chatOpen}
        onClose={closeChat}
        channel={activeChannel}
        channelLoading={channelLoading}
        userId={userId}
        consultationTypeIcon="videocam"
      />
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

  // paddingBottom is overridden inline with the device safe-area inset added — see JSX.
  controls: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
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
})
