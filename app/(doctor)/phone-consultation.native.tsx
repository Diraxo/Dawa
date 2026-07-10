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

const ClientRoleBroadcaster = 1

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
const MUTE_DEBOUNCE_MS = 4_000

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

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

function formatTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

function StatusBadge({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View style={badge.pill}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[badge.text, { color }]}>{label}</Text>
    </View>
  )
}

const badge = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  text: { fontFamily: fonts.semiBold, fontSize: 13 },
})

function CtrlBtn({ icon, label, active = false, disabled = false, onPress }: {
  icon: string; label: string; active?: boolean; disabled?: boolean; onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        ctrl.btn,
        active && ctrl.btnActive,
        disabled && ctrl.btnDisabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
      onPress={disabled ? undefined : () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress()
      }}
    >
      <Ionicons
        name={icon as any}
        size={24}
        color={disabled ? 'rgba(255,255,255,0.25)' : active ? colors.mistWhite : 'rgba(255,255,255,0.85)'}
      />
      <Text style={[ctrl.label, active && ctrl.labelActive, disabled && ctrl.labelDisabled]}>{label}</Text>
    </Pressable>
  )
}

const ctrl = StyleSheet.create({
  btn: {
    alignItems: 'center', gap: 6,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
  },
  btnActive: { backgroundColor: colors.careBlue },
  btnDisabled: { backgroundColor: 'rgba(255,255,255,0.04)' },
  label: { fontFamily: fonts.medium, fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  labelActive: { color: colors.mistWhite },
  labelDisabled: { color: 'rgba(255,255,255,0.25)' },
})

export default function DoctorPhoneConsultationScreen() {
  ScreenCapture.usePreventScreenCapture()
  const {
    patientName,
    chiefComplaint,
    consultationId,
    resumeElapsed,
  } = useLocalSearchParams<{
    patientName?: string
    chiefComplaint?: string
    consultationId?: string
    resumeElapsed?: string
  }>()
  const router = useRouter()
  const { userId } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, setConnectionStatus } = useActiveConsultationStore()
  const displayName = patientName ?? 'Patient'

  const [muted, setMuted] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [networkQuality, setNetworkQuality] = useState<0|1|2|3|4|5|6>(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [localError, setLocalError] = useState(false)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [showInfoSheet, setShowInfoSheet] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false)
  const [tokenRetryKey, setTokenRetryKey] = useState(0)
  const [reconnectCountdown, setReconnectCountdown] = useState(90)
  const [chatOpen, setChatOpen] = useState(false)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const channelName = consultationId ?? 'consult-demo'
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

  useHeartbeat(consultationId as string | undefined, callStatus === 'connected')

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userOfflineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatSlide = useRef(new Animated.Value(0)).current
  const callPulse = useRef(new Animated.Value(1)).current
  const ringPulse = useRef(new Animated.Value(1)).current
  const chatOpenRef = useRef(false)
  const endedHandledRef = useRef(false)

  // Once the DB-derived phase reaches 'ended' — patient declined/missed the
  // call, or it completed/ended abnormally on some other device/session —
  // release Agora resources and navigate away exactly once.
  useEffect(() => {
    if (state.phase !== 'ended' || endedHandledRef.current) return
    endedHandledRef.current = true
    try { getAgoraEngine()?.leaveChannel() } catch {}
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

  // ── Ringing animation (for calling/waiting state) ──────────────────────────
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, { toValue: 1.14, duration: 700, useNativeDriver: true }),
        Animated.timing(ringPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  // ── Call pulse animation ───────────────────────────────────────────────────
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(callPulse, { toValue: 1.07, duration: 900, useNativeDriver: true }),
        Animated.timing(callPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  // ── Active consultation store ──────────────────────────────────────────────
  useEffect(() => {
    if (!consultationId) return
    setActive({
      consultationId,
      type: 'phone',
      otherPersonName: displayName,
      role: 'doctor',
      elapsedSeconds: seconds,
      status: callStatus === 'reconnecting' ? 'reconnecting' : 'active',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  useEffect(() => { updateElapsed(seconds) }, [seconds, updateElapsed])
  useEffect(() => {
    setConnectionStatus(callStatus === 'reconnecting' ? 'reconnecting' : 'active')
  }, [callStatus, setConnectionStatus])

  // ── Background notification ────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      // Only fire when an active call is running — not during outgoing ringing (waiting)
      if (state === 'background' && (callStatus === 'connected' || callStatus === 'reconnecting')) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Ongoing Consultation',
            body: `Tap to return to your call with ${displayName}`,
            sound: 'default',
            data: { screen: 'consultation', consultationId, consultationType: 'phone', patientName: displayName },
          },
          trigger: null,
        }).catch(() => {})
      }
    })
    return () => sub.remove()
  }, [callStatus, consultationId, displayName])

  // ── Token fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!channelName) return
    setTokenFetchFailed(false)
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(token => { setAgoraToken(token); setTokenFetchFailed(false) })
        .catch(err => { logger.error('[Phone][Doctor] Token fetch failed:', err); setTokenFetchFailed(true) })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, localUid, tokenRetryKey])

  // ── Agora engine ──────────────────────────────────────────────────────────
  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID
    if (!appId || !channelName || !agoraToken) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try { engine = getAgoraEngine() } catch (e) {
      logger.error('[Phone][Doctor] getAgoraEngine failed:', e)
      setLocalError(true)
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
        try {
          await supabase.from('consultations').update({ status: 'ended_abnormally' }).eq('id', channelName).eq('status', 'in_progress')
        } catch {}
        if (mounted) {
          setActive(null)
          router.replace('/(doctor)/(tabs)/consultations' as any)
        }
      }, GRACE_PERIOD_MS)
    }

    const handler = {
      onJoinChannelSuccess: (connection: any) => {
        logger.log('[Phone][Doctor] onJoinChannelSuccess channel:', connection?.channelId)
        // Re-apply the user's chosen mute state to the (possibly brand-new,
        // post-retry) engine — a fresh join always defaults to unmuted.
        try { engine?.muteLocalAudioStream(mutedRef.current) } catch {}
        // Our own join+publish succeeded (joinChannel publishes the mic track
        // directly for RTC engine calls) — report only our own milestone. The
        // DB trigger flips status/started_at once the patient's own write
        // lands too; both clients learn of it from the same row update.
        state.markSelfConnected()
      },
      onUserJoined: (_conn: any, uid: number) => {
        logger.log('[Phone][Doctor] onUserJoined uid:', uid)
        if (!mounted) return
        remoteUidRef.current = uid
        if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
        clearGracePeriod()
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
        setIsReconnecting(false)
        setRemoteMuted(false)
        setLocalError(false)
      },
      onUserOffline: (_conn: any, uid: number, reason: number) => {
        logger.log('[Phone][Doctor] onUserOffline uid:', uid, 'reason:', reason)
        if (!mounted || uid !== remoteUidRef.current) return
        // Debounce: 4s window so a mute event can cancel the offline transition
        if (userOfflineDebounceRef.current) clearTimeout(userOfflineDebounceRef.current)
        userOfflineDebounceRef.current = setTimeout(() => {
          userOfflineDebounceRef.current = null
          if (!mounted) return
          remoteUidRef.current = null
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
      onConnectionStateChanged: (_conn: any, state: number, reason: number) => {
        logger.log('[Phone][Doctor] onConnectionStateChanged state:', state, 'reason:', reason)
        if (state === 5 && mounted) setLocalError(true)
        if (reason === 19 && mounted) Alert.alert('Session Ended', 'You joined from another device.')
      },
      onTokenPrivilegeWillExpire: () => {
        getToken().then(async tok => {
          if (!tok) return
          try {
            const refreshed = await fetchAgoraToken(channelName, localUid, tok)
            engine?.renewToken(refreshed)
          } catch (e) { logger.error('[Phone][Doctor] Token renewal failed:', e) }
        })
      },
      onNetworkQuality: (_uid: any, txQuality: number) => {
        if (mounted) setNetworkQuality(txQuality as any)
      },
      onError: (err: any, msg: string) => {
        logger.error('[Phone][Doctor] Agora error:', err, msg)
        if (mounted) setLocalError(true)
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
        engine!.disableVideo()
        engine!.setEnableSpeakerphone(false)
        engine!.setCloudProxy(3)
        logger.log(`[Phone][Doctor] joinChannel → channel:${channelName} uid:${localUid}`)
        const code = engine!.joinChannel(agoraToken, channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          autoSubscribeAudio: true,
        })
        if (typeof code === 'number' && code < 0) {
          logger.error('[Phone][Doctor] joinChannel rejected:', code)
          if (mounted) setLocalError(true)
          return
        }
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            setLocalError(true)
          }
        }, 90000)
      } catch (e) {
        logger.error('[Phone][Doctor] startCall error:', e)
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
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraToken, channelName, localUid])

  // Sync mute / speaker
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalAudioStream(muted) } catch {}
  }, [muted, agoraReady])
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
    if (!consultationId || !Chat || activeChannel) return
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
        logger.error('[DoctorPhoneChat] watch failed:', err)
      } finally {
        if (!cancelled) setChannelLoading(false)
      }
    })()
    return () => { cancelled = true }
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
          logger.error('[DoctorPhone] save summary failed:', summaryError)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
        const { error: statusError } = await client
          .from('consultations')
          .update({ status: 'completed', ended_at: new Date().toISOString(), duration_minutes: Math.ceil(seconds / 60) })
          .eq('id', consultationId)
        if (statusError) {
          logger.error('[DoctorPhone] mark completed failed:', statusError)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
        // Stream channel locking is now handled server-side by a DB trigger
        // (on_consultation_change → freeze-consultation-channel Edge Function)
        // the instant status flips to 'completed' above — no client call needed.
      }
    } catch (err) {
      logger.error('[DoctorPhone] save summary failed:', err)
      Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
      return
    }
    try { getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
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
            try { getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
            setActive(null)
            router.replace('/(doctor)/(tabs)/consultations' as any)
          },
        },
      ])
      return
    }
    setShowEndSheet(true)
  }

  const chatSlideY = chatSlide.interpolate({ inputRange: [0, 1], outputRange: [700, 0] })

  const netLabel = networkQuality === 0 ? '' : networkQuality <= 2 ? 'Excellent' : networkQuality <= 4 ? 'Good' : 'Poor'
  const netColor = networkQuality <= 2 ? colors.success : networkQuality <= 4 ? colors.warning : colors.error
  const isConnected = callStatus === 'connected'
  const isConnecting = callStatus === 'connecting'
  const isActive = callStatus === 'connected' || callStatus === 'reconnecting'

  // ── CALLING / RINGING UI (doctor joined Agora, patient not yet answered) ─────
  if (callStatus === 'waiting') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.callingScreen}>
          {/* Badge */}
          <View style={styles.callingBadge}>
            <Ionicons name="call" size={13} color={colors.tealGreen} />
            <Text style={styles.callingBadgeText}>Outgoing Phone Consultation</Text>
          </View>

          {/* Animated avatar with concentric rings */}
          <View style={styles.callingCenter}>
            <Animated.View style={[styles.ringOuter, { transform: [{ scale: ringPulse }] }]}>
              <View style={styles.ringMid}>
                <View style={styles.ringInner}>
                  {patientPhotoUrl ? (
                    <Image source={{ uri: patientPhotoUrl }} style={styles.ringInnerImage} />
                  ) : (
                    <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
                  )}
                </View>
              </View>
            </Animated.View>
            <Text style={styles.callingName}>{displayName}</Text>
            <Text style={styles.callerRole}>Patient</Text>
            {chiefComplaint ? (
              <View style={styles.complaintPill}>
                <Ionicons name="document-text-outline" size={13} color={colors.tealGreen} />
                <Text style={styles.complaintText} numberOfLines={1}>{chiefComplaint}</Text>
              </View>
            ) : null}
            <View style={styles.callingStatusRow}>
              <ActivityIndicator size="small" color={colors.tealGreen} style={{ marginRight: 8 }} />
              <Text style={styles.callingStatusText}>Ringing…</Text>
            </View>
          </View>

          {/* Controls: optional mute + end call */}
          <View style={styles.callingActions}>
            <Pressable
              style={({ pressed }) => [ctrl.btn, muted && ctrl.btnActive, pressed && { opacity: 0.75 }]}
              onPress={toggleMute}
            >
              <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color={muted ? colors.mistWhite : 'rgba(255,255,255,0.85)'} />
              <Text style={[ctrl.label, muted && ctrl.labelActive]}>{muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Pressable
                style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.82 }]}
                onPress={handleEnd}
              >
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </Pressable>
              <Text style={styles.endBtnLabel}>End</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── MAIN ACTIVE CALL UI ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* ── Status area ── */}
      <View style={styles.statusArea}>
        <View style={styles.statusBadgeRow}>
          <StatusBadge
            icon={isConnected ? 'checkmark-circle' : 'ellipsis-horizontal-circle'}
            label={isConnected ? 'Connected' : callStatus === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
            color={isConnected ? colors.success : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen}
          />
          <StatusBadge icon="shield-checkmark" label="Secure" color={colors.tealGreen} />
          {isConnected && networkQuality > 0 && (
            <StatusBadge icon="wifi" label={netLabel} color={netColor} />
          )}
        </View>

        <Text style={styles.timerLarge}>
          {isActive && startedAtIso ? formatTime(seconds) : '--:--'}
        </Text>

        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: callPulse }] }]}>
          {patientPhotoUrl ? (
            <Image source={{ uri: patientPhotoUrl }} style={styles.avatarWrapImage} />
          ) : (
            <Ionicons name="person" size={44} color="rgba(255,255,255,0.5)" />
          )}
        </Animated.View>

        <Text style={styles.callerName}>{displayName}</Text>
        <Text style={styles.callerSub}>Patient</Text>

        {chiefComplaint ? (
          <View style={styles.complaintPill}>
            <Ionicons name="document-text-outline" size={13} color={colors.tealGreen} />
            <Text style={styles.complaintText} numberOfLines={1}>{chiefComplaint}</Text>
          </View>
        ) : null}

        {remoteMuted && isConnected && (
          <View style={styles.remoteMutedPill}>
            <Ionicons name="mic-off" size={12} color={colors.warning} />
            <Text style={styles.remoteMutedText}>Patient is muted</Text>
          </View>
        )}
      </View>

      {/* ── Info card ── */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Consultation</Text>
          <Text style={styles.infoValue}>Phone call</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status</Text>
          <View style={styles.infoValueRow}>
            <View style={[styles.dot, {
              backgroundColor: isConnected ? colors.success : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen
            }]} />
            <Text style={[styles.infoValue, {
              color: isConnected ? colors.success : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen
            }]}>
              {isConnected ? 'In progress' : callStatus === 'reconnecting' ? 'Reconnecting…' : callStatus === 'error' ? 'Connection Lost' : 'Connecting…'}
            </Text>
          </View>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Network</Text>
          {networkQuality === 0
            ? <Text style={styles.infoValue}>—</Text>
            : (
              <View style={styles.infoValueRow}>
                <Ionicons name="wifi" size={14} color={netColor} />
                <Text style={[styles.infoValue, { color: netColor }]}>{netLabel}</Text>
              </View>
            )
          }
        </View>

        {isConnecting && (
          <View style={styles.infoStatusRow}>
            <ActivityIndicator size="small" color={colors.tealGreen} />
            <Text style={[styles.infoStatusText, { color: colors.tealGreen }]}>Establishing secure connection…</Text>
          </View>
        )}
        {callStatus === 'reconnecting' && (
          <View style={styles.infoStatusRow}>
            <ActivityIndicator size="small" color={colors.warning} />
            <Text style={[styles.infoStatusText, { color: colors.warning }]}>
              Reconnecting…
            </Text>
          </View>
        )}
        {(callStatus === 'error' || tokenFetchFailed) && (
          <Pressable
            style={styles.retryRow}
            onPress={() => { setLocalError(false); setTokenRetryKey(k => k + 1) }}
          >
            <Ionicons name="refresh" size={14} color={colors.error} />
            <Text style={styles.retryText}>Unable to connect — tap to retry</Text>
          </Pressable>
        )}
      </View>

      {/* ── Controls: 5 buttons ── */}
      <View style={styles.controls}>
        <CtrlBtn
          icon={muted ? 'mic-off' : 'mic'}
          label={muted ? 'Unmute' : 'Mute'}
          active={muted}
          disabled={isConnecting}
          onPress={() => setMuted(m => !m)}
        />
        <CtrlBtn
          icon={speakerOn ? 'volume-high' : 'volume-medium'}
          label="Speaker"
          active={speakerOn}
          disabled={isConnecting}
          onPress={() => setSpeakerOn(s => !s)}
        />
        {/* Chat button with unread badge */}
        <View>
          <CtrlBtn
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
        <CtrlBtn
          icon="information-circle"
          label="Info"
          active={showInfoSheet}
          disabled={isConnecting}
          onPress={() => setShowInfoSheet(v => !v)}
        />
        <Pressable
          style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.82 }]}
          onPress={handleEnd}
        >
          <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          <Text style={styles.endBtnLabel}>End</Text>
        </Pressable>
      </View>

      {/* ── Info bottom sheet ── */}
      {showInfoSheet && (
        <View style={styles.infoSheet}>
          <View style={styles.panelHandle} />
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Consultation Info</Text>
            <Pressable onPress={() => setShowInfoSheet(false)} hitSlop={12}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <View style={styles.infoSheetBody}>
            <View style={styles.infoSheetRow}>
              <Text style={styles.infoSheetLabel}>Patient</Text>
              <Text style={styles.infoSheetValue}>{displayName}</Text>
            </View>
            {consultationId && (
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Consultation ID</Text>
                <Text style={styles.infoSheetValue}>…{consultationId.slice(-8)}</Text>
              </View>
            )}
            {startedAtIso && (
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Started</Text>
                <Text style={styles.infoSheetValue}>{formatTimestamp(startedAtIso)}</Text>
              </View>
            )}
            {startedAtIso && (
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Duration</Text>
                <Text style={styles.infoSheetValue}>{formatTime(seconds)}</Text>
              </View>
            )}
            {networkQuality > 0 && (
              <View style={styles.infoSheetRow}>
                <Text style={styles.infoSheetLabel}>Network</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="wifi" size={14} color={netColor} />
                  <Text style={[styles.infoSheetValue, { color: netColor }]}>{netLabel}</Text>
                </View>
              </View>
            )}
            <View style={styles.infoSheetRow}>
              <Text style={styles.infoSheetLabel}>Connection</Text>
              <Text style={styles.infoSheetValue}>Agora Cloud</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Chat bottom sheet ── */}
      {chatOpen && (
        <Animated.View style={[styles.chatPanel, { transform: [{ translateY: chatSlideY }] }]}>
          <View style={styles.panelHandle} />
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>In-call chat</Text>
            <View style={styles.callContinues}>
              <Ionicons name="call" size={13} color={colors.tealGreen} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080E22' },

  // ── Calling / Ringing screen (doctor waiting for patient to answer) ──────────
  callingScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28,
  },
  callingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,191,165,0.12)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(0,191,165,0.25)',
  },
  callingBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },
  callingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  ringOuter: {
    width: 210, height: 210, borderRadius: 105,
    backgroundColor: 'rgba(0,191,165,0.07)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  ringMid: {
    width: 172, height: 172, borderRadius: 86,
    backgroundColor: 'rgba(0,191,165,0.11)',
    alignItems: 'center', justifyContent: 'center',
  },
  ringInner: {
    width: 134, height: 134, borderRadius: 67,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
    overflow: 'hidden',
  },
  ringInnerImage: { width: '100%', height: '100%', borderRadius: 67 },
  callingName: { fontFamily: fonts.bold, fontSize: 28, color: colors.mistWhite, textAlign: 'center' },
  callerRole: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.45)' },
  callingStatusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  callingStatusText: { fontFamily: fonts.medium, fontSize: 14, color: colors.tealGreen },
  callingActions: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center',
    gap: 64, paddingBottom: 36,
  },

  // ── Active call screen ───────────────────────────────────────────────────────
  statusArea: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, gap: 8,
  },
  statusBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap', justifyContent: 'center' },

  timerLarge: {
    fontFamily: fonts.bold, fontSize: 54, color: colors.mistWhite,
    letterSpacing: 2, marginVertical: 4,
  },
  avatarWrap: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(0,191,165,0.45)',
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
    overflow: 'hidden',
  },
  avatarWrapImage: { width: '100%', height: '100%', borderRadius: 50 },
  callerName: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, textAlign: 'center' },
  callerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },

  complaintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,191,165,0.1)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 4,
    borderWidth: 1, borderColor: 'rgba(0,191,165,0.25)',
  },
  complaintText: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.7)', maxWidth: 200 },

  remoteMutedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,193,7,0.12)', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,193,7,0.3)', marginTop: 4,
  },
  remoteMutedText: { fontFamily: fonts.medium, fontSize: 12, color: colors.warning },

  infoCard: {
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 18, paddingVertical: 14, gap: 2,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  infoDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  infoLabel: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  infoValue: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  infoValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  infoStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 2,
  },
  infoStatusText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  retryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 2,
  },
  retryText: { fontFamily: fonts.medium, fontSize: 13, color: colors.error },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingBottom: 32, paddingTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  endBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  endBtnLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#fff' },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#080E22',
  },
  unreadBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },

  // ── Info sheet ───────────────────────────────────────────────────────────────
  infoSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#10172B',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 8, elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5, shadowRadius: 16,
  },
  infoSheetBody: { paddingHorizontal: 20, paddingBottom: 32 },
  infoSheetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  infoSheetLabel: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  infoSheetValue: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },

  // ── Shared panel styles ───────────────────────────────────────────────────────
  chatPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '64%',
    backgroundColor: '#10172B',
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
})
