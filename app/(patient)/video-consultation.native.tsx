import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
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

import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { CallInfoPanel } from '@/components/consultation/CallInfoPanel'
import { InCallChatPanel } from '@/components/consultation/InCallChatPanel'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { getAuthClient, supabase } from '@/lib/supabase'
import { streamClient, watchConsultationChannel } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { callkeep } from '@/lib/callkeep'
import { logger } from '@/lib/logger'
import { formatDoctorName } from '@/lib/nameFormat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { localizeNotificationPhoto } from '@/lib/notificationPhoto'

const GRACE_PERIOD_MS = 90_000
const RING_TIMEOUT_SECS = 60
const MUTE_DEBOUNCE_MS = 4_000

// Use a locally bundled ringtone so it works offline and loads instantly
// Replace assets/sounds/ringtone.wav with any high-quality MP3/WAV for production
let RINGTONE_SOURCE: ReturnType<typeof require> | { uri: string }
try {
  RINGTONE_SOURCE = require('@/assets/sounds/ringtone.wav')
} catch {
  RINGTONE_SOURCE = { uri: 'https://assets.mixkit.co/sfx/preview/mixkit-classic-alarm-995.mp3' }
}

// waiting_for_doctor — accepted status not seen yet; mirrors the phone screen's pre-ring waiting room
// ringing      — incoming call screen; patient has NOT joined Agora yet
// connecting   — patient tapped Answer, Agora is joining
// waiting      — joined Agora, waiting for doctor to publish video/audio
// connected    — both parties in call
// reconnecting — remote user dropped, grace period running
// error        — Agora join failed
type CallStatus = 'waiting_for_doctor' | 'ringing' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

export default function VideoConsultationScreen() {
  const insets = useSafeAreaInsets()
  const {
    doctorId,
    doctorName: doctorNameParam,
    doctorPhotoUrl: doctorPhotoUrlParam,
    consultationId,
    resumeElapsed,
    fromCallkeep,
  } = useLocalSearchParams<{
    doctorId?: string
    doctorName?: string
    doctorPhotoUrl?: string
    consultationId?: string
    resumeElapsed?: string
    fromCallkeep?: string  // '1' when navigated here after answering via OS call screen
  }>()

  // Doctor identity kept live via Realtime so a rename/photo change mid-call
  // reflects here immediately instead of staying stuck on the nav-time value.
  const { name: liveDoctorName, photoUrl: liveDoctorPhotoUrl } = useUserProfileRealtime(
    doctorId ?? null,
    doctorNameParam ?? null,
    doctorPhotoUrlParam ?? null
  )
  const doctorName = liveDoctorName ?? doctorNameParam
  const doctorPhotoUrl = liveDoctorPhotoUrl ?? doctorPhotoUrlParam

  ScreenCapture.usePreventScreenCapture()
  const router = useRouter()
  const { userId, isStreamConnected } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, setConnectionStatus } = useActiveConsultationStore()

  // fromCallkeep='1' → patient answered via OS call screen, skip ringing UI
  const answeredViaCallkeep = fromCallkeep === '1'
  const skipRinging = answeredViaCallkeep || !!resumeElapsed

  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [selfViewHidden, setSelfViewHidden] = useState(false)
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  // Pre-accept-only local UI state — entirely outside the DB-derived call
  // phase, which only ever concerns itself with post-'accepted' status. Once
  // 'answered', displayed call status comes solely from useConsultationState.
  const [ringPhase, setRingPhase] = useState<'waiting_for_doctor' | 'ringing' | 'answered'>(
    skipRinging ? 'answered' : 'ringing'
  )
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [localError, setLocalError] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false)
  const [tokenRetryKey, setTokenRetryKey] = useState(0)
  const [reconnectCountdown, setReconnectCountdown] = useState(90)
  const [ringCountdown, setRingCountdown] = useState(RING_TIMEOUT_SECS)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [networkQuality, setNetworkQuality] = useState<0|1|2|3|4|5|6>(0)
  const [showInfoSheet, setShowInfoSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  // Gates token fetch and Agora join — true once patient answers (or skipped via callkeep/resume)
  const [readyToJoin, setReadyToJoin] = useState(skipRinging)

  const channelName = consultationId ?? `consult-${doctorId ?? 'demo'}`
  const localUid = useMemo(() => userId ? uidFromString(userId) : 1, [userId])

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

  // Single source of truth for call phase/timer — derived from the DB row via
  // Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: channelName, role: 'patient', localAgoraReconnecting: isReconnecting })
  const phaseRef = useRef(state.phase)
  useEffect(() => { phaseRef.current = state.phase }, [state.phase])
  const seconds = state.elapsedSeconds ?? 0
  const startedAtIso = state.startedAtIso

  // Doctor accepted while this screen was showing the waiting-room —
  // transition to the ringing screen. Reuses the hook's own Realtime
  // subscription (via rawStatus) instead of a second one.
  useEffect(() => {
    if (ringPhase === 'waiting_for_doctor' && state.rawStatus === 'accepted') {
      setRingPhase('ringing')
    }
  }, [ringPhase, state.rawStatus])

  // ── Initial pre-accept status check ───────────────────────────────────────
  // Only concerned with the waiting-room/ringing screens here; call
  // phase/timer themselves come from useConsultationState, not from here.
  useEffect(() => {
    if (!consultationId) return
    getToken().then(async token => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('consultations')
        .select('status')
        .eq('id', consultationId as string)
        .single()
      if (!data) return
      if (data.status === 'accepted' || data.status === 'in_progress') {
        setReadyToJoin(true)
      } else if (data.status === 'pending' || data.status === 'scheduled') {
        // Doctor hasn't accepted yet — show WAITING_FOR_DOCTOR
        setRingPhase('waiting_for_doctor')
      }
      // 'accepted' status → keep default 'ringing' (doctor accepted and is calling)
    }).catch(() => {})
  }, [consultationId])

  const callStatus: CallStatus = ringPhase === 'waiting_for_doctor'
    ? 'waiting_for_doctor'
    : ringPhase === 'ringing'
    ? 'ringing'
    : localError
    ? 'error'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? 'connected'
    : state.phase === 'waiting_for_doctor'
    ? 'waiting'
    : 'connecting'

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userOfflineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null)
  const endedHandledRef = useRef(false)
  const chatOpenRef = useRef(false)

  // Sends a heartbeat UPDATE to consultations.last_heartbeat_at every 30s
  // while connected, so the server-side stale-consultation cleanup can tell
  // a crashed mobile call apart from a genuinely long-running one.
  useHeartbeat(consultationId, callStatus === 'connected')

  // Once the DB-derived phase reaches 'ended' — the doctor ended the call, or
  // it completed/ended abnormally on some other device/session — release
  // Agora resources and navigate away exactly once.
  useEffect(() => {
    if (state.phase !== 'ended' || endedHandledRef.current) return
    endedHandledRef.current = true
    try { getAgoraEngine()?.leaveChannel() } catch {}
    releaseAgoraEngine()
    if (consultationId) clearPersistedMute(consultationId)
    setActive(null)
    if (consultationId) callkeep.reportCallEnded(consultationId, 'remoteEnded')
    Alert.alert('Call Ended', 'The doctor has ended the consultation.', [
      { text: 'OK', onPress: () => router.replace('/(patient)/(tabs)/appointments' as any) },
    ])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // ── Ringtone + vibration ───────────────────────────────────────────────────
  useEffect(() => {
    if (ringPhase !== 'ringing') return
    let mounted = true
    async function play() {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
        const { sound } = await Audio.Sound.createAsync(
          RINGTONE_SOURCE,
          { isLooping: true, volume: 1.0 }
        )
        if (!mounted) { await sound.unloadAsync(); return }
        ringtoneSoundRef.current = sound
        await sound.playAsync()
      } catch {}
    }
    play()
    Vibration.vibrate([0, 1000, 1000], true)
    return () => {
      mounted = false
      Vibration.cancel()
      ringtoneSoundRef.current?.stopAsync()
        .finally(() => ringtoneSoundRef.current?.unloadAsync())
        .catch(() => {})
      ringtoneSoundRef.current = null
    }
  }, [ringPhase])

  // ── Ring countdown — auto-decline after RING_TIMEOUT_SECS ────────────────
  useEffect(() => {
    if (ringPhase !== 'ringing') return
    setRingCountdown(RING_TIMEOUT_SECS)
    ringTimerRef.current = setInterval(() => {
      setRingCountdown(c => {
        if (c <= 1) {
          clearInterval(ringTimerRef.current!)
          ringTimerRef.current = null
          handleMissedCall()
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => { if (ringTimerRef.current) clearInterval(ringTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringPhase])

  const handleMissedCall = async () => {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    // Dismiss any OS call screen that may still be showing
    if (consultationId) callkeep.endIncomingCall(consultationId)
    logger.log('[Video][Patient] Missed call / declined — marking missed')
    try {
      const token = await getToken()
      if (token && consultationId) {
        // DB trigger fires the doctor's missed-call notification off this
        // status change — no separate client-side notification call needed.
        await getAuthClient(token)
          .from('consultations')
          .update({ status: 'missed' })
          .eq('id', consultationId)
      }
    } catch {}
    router.replace('/(patient)/(tabs)/appointments' as any)
  }

  // Explicit decline tap — distinct from a silent ring timeout (handleMissedCall
  // above): recorded as 'call_declined' so doctor-side copy and admin records
  // accurately show "the patient declined" rather than "no response".
  const handleDecline = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    if (consultationId) callkeep.endIncomingCall(consultationId)
    try {
      const token = await getToken()
      if (token && consultationId) {
        // DB trigger fires the doctor's call_declined notification off this
        // status change — no separate client-side notification call needed.
        await getAuthClient(token).from('consultations').update({ status: 'call_declined' }).eq('id', consultationId)
      }
    } catch {}
    router.replace('/(patient)/(tabs)/appointments' as any)
  }

  const handleAnswer = () => {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    logger.log('[Video][Patient] Patient answered — starting Agora join')
    setRingPhase('answered')
    setReadyToJoin(true)
  }

  // ── Populate active consultation store so banner stays alive ─────────────
  useEffect(() => {
    if (!consultationId || ringPhase !== 'answered') return
    setActive({
      consultationId,
      type: 'video',
      otherPersonName: doctorName ?? 'Doctor',
      otherPersonPhotoUrl: doctorPhotoUrl,
      role: 'patient',
      elapsedSeconds: seconds,
      status: callStatus === 'reconnecting' ? 'reconnecting' : 'active',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, ringPhase])

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
            const localPhotoUri = await localizeNotificationPhoto(doctorPhotoUrl)
            Notifications.scheduleNotificationAsync({
              content: {
                title: `Call with ${formatDoctorName(doctorName)}`,
                body: `Tap to return to your video call with ${formatDoctorName(doctorName)}`,
                sound: 'default',
                data: {
                  screen: 'consultation',
                  consultationId,
                  consultationType: 'video',
                  doctorName: doctorName ?? 'Doctor',
                  doctorId: doctorId ?? '',
                  doctorPhotoUrl: doctorPhotoUrl ?? '',
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
          getAgoraEngine()?.muteLocalVideoStream(cameraOff)
        } catch {}
      }
    })
    return () => sub.remove()
  }, [callStatus, consultationId, doctorName, doctorId, doctorPhotoUrl, cameraOff])

  // ── Fetch Agora token — prefetched during ringing, not gated on Answer ────
  // Fetching only needs a Clerk token (no camera/mic consent), so start it
  // as soon as the channel is known — same as the doctor screen already
  // does — instead of waiting for the Answer tap, to keep the token round
  // trip off the critical path between "tap Answer" and media flowing.
  useEffect(() => {
    if (!channelName) return
    setTokenFetchFailed(false)
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(token => { setAgoraToken(token); setTokenFetchFailed(false) })
        .catch((err) => { logger.error('[Agora] Video token fetch failed:', err); setTokenFetchFailed(true) })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, localUid, tokenRetryKey])

  // ── Agora engine — only after token arrives and patient has answered ──────
  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID
    if (!appId || !channelName || !agoraToken || !readyToJoin || !muteLoaded) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try {
      engine = getAgoraEngine()
    } catch (e) {
      logger.error('[Video][Patient] getAgoraEngine failed:', e)
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
        logger.warn('[Video][Patient] Grace period expired — marking ended_abnormally')
        try {
          await supabase
            .from('consultations')
            .update({ status: 'ended_abnormally' })
            .eq('id', channelName)
            .eq('status', 'in_progress')
        } catch {}
        if (mounted) {
          setActive(null)
          router.replace({
            pathname: '/(patient)/consultation-summary',
            params: { consultationId, doctorId, doctorName, consultationType: 'video' },
          })
        }
      }, GRACE_PERIOD_MS)
    }

    const handler = {
      onJoinChannelSuccess: (connection: any) => {
        logger.log(`[Video][Patient][${Date.now()}] onJoinChannelSuccess channel:${connection?.channelId} uid:${connection?.localUid}`)
        // Re-apply the user's chosen mute state to the (possibly brand-new,
        // post-retry) engine — a fresh join always defaults to unmuted.
        try { engine?.muteLocalAudioStream(mutedRef.current) } catch {}
        // Our own join+publish succeeded (joinChannel publishes mic+camera
        // directly for RTC engine calls) — report only our own milestone. The
        // DB trigger flips status/started_at once the doctor's own write
        // lands too; both clients learn of it from the same row update.
        state.markSelfConnected()
        // Clear the connecting-stuck timeout; we're past join
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      },
      onUserJoined: (_conn: any, uid: number) => {
        logger.log(`[Video][Patient][${Date.now()}] onUserJoined remoteUid:${uid}`)
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
        logger.log(`[Video][Patient][${Date.now()}] onUserOffline uid:${uid} reason:${reason}`)
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
        logger.log(`[Video][Patient][${Date.now()}] connectionStateChanged state:${state} reason:${reason}`)
        // state 4 = RECONNECTING, state 5 = FAILED. Without this, a network
        // blip on THIS device is invisible locally (only the peer's
        // onUserOffline would show it), so the two sides can disagree about
        // whether the call is currently healthy.
        if (state === 4 && mounted) { setIsReconnecting(true) }
        if (state === 3 && mounted) { setIsReconnecting(false) }
        if (state === 5 && mounted) { logger.error('[Video][Patient] Connection FAILED'); proxyFallbackRef.current = true; setLocalError(true) }
        if (reason === 19 && mounted) {
          Alert.alert('Session Ended', 'You joined this consultation from another device.')
        }
      },
      onError: (errorCode: number, msg: string) => {
        logger.error(`[Video][Patient][${Date.now()}] Agora error code:${errorCode} msg:${msg}`)
        proxyFallbackRef.current = true
        if (mounted) setLocalError(true)
      },
      onTokenPrivilegeWillExpire: (_conn: any, _token: string) => {
        getToken().then(async tok => {
          if (!tok) return
          try {
            const refreshed = await fetchAgoraToken(channelName, localUid, tok)
            engine?.renewToken(refreshed)
          } catch (e) { logger.error('[Video][Patient] Token renewal failed:', e) }
        })
      },
    }

    engine.registerEventHandler(handler)

    async function startCall() {
      try {
        const { status: micStatus } = await Audio.requestPermissionsAsync()
        if (!mounted) return
        if (micStatus !== 'granted') {
          Alert.alert('Microphone Required', 'Please allow microphone access to join the call.')
          setLocalError(true)
          return
        }

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
        engine!.startPreview()
        engine!.setEnableSpeakerphone(speakerOn)
        if (proxyFallbackRef.current) engine!.setCloudProxy(3)

        logger.log(`[Video][Patient][${Date.now()}] joinChannel → channel:${channelName} uid:${localUid} tokenLen:${agoraToken?.length ?? 0} proxy:${proxyFallbackRef.current}`)
        const code = engine!.joinChannel(agoraToken, channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: true,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        })
        logger.log(`[Video][Patient][${Date.now()}] joinChannel returned code:${code}`)
        if (typeof code === 'number' && code < 0) {
          logger.error('[Video][Patient] joinChannel rejected code:', code)
          proxyFallbackRef.current = true
          if (mounted) setLocalError(true)
          return
        }

        // 30-second timeout covers BOTH 'connecting' (join never succeeded) and
        // 'waiting' (joined but remote user never appeared).
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            logger.error(`[Video][Patient][${Date.now()}] Connection timeout — stuck in phase:${phaseRef.current}`)
            proxyFallbackRef.current = true
            setLocalError(true)
          }
        }, 30000)
      } catch (e) {
        logger.error('[Video][Patient] startCall error:', e)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraToken, channelName, localUid, readyToJoin, muteLoaded])

  // Sync mute
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalAudioStream(muted) } catch {}
  }, [muted, agoraReady])

  // Sync camera
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalVideoStream(cameraOff) } catch {}
  }, [cameraOff, agoraReady])

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
    if (!consultationId || !Chat || activeChannel) return
    // streamClient.channel() throws "Call connectUser..." until the Stream
    // socket handshake (kicked off by useStreamConnection) finishes — userId
    // is set into the auth store slightly before that resolves.
    if (!isStreamConnected) return
    let cancelled = false
    setChannelLoading(true)
    ;(async () => {
      try {
        // Pass members so watch() self-heals channel membership instead of
        // relying solely on membership set up elsewhere at accept-time.
        const { data } = await supabase
          .from('consultations')
          .select('doctor:doctor_profiles(user:users(clerk_id))')
          .eq('id', consultationId)
          .single()
        const doctorClerkId = (data as any)?.doctor?.user?.clerk_id as string | undefined
        const members = userId && doctorClerkId ? [userId, doctorClerkId] : undefined
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
        logger.error('[PatientVideoChat] watch failed:', err)
      } finally {
        if (!cancelled) setChannelLoading(false)
      }
    })()
    return () => { cancelled = true }
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

  const handleSwitchCamera = () => {
    if (!agoraReady) return
    try { getAgoraEngine().switchCamera() } catch {}
  }

  const isConnecting = callStatus === 'connecting'

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    Alert.alert('End Call', 'Are you sure you want to end this video call?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Call',
        style: 'destructive',
        onPress: () => {
          try { getAgoraEngine()?.leaveChannel() } catch {}
          releaseAgoraEngine()
          if (consultationId) callkeep.reportCallEnded(consultationId, 'remoteEnded')
          setActive(null)
          router.replace({
            pathname: '/(patient)/consultation-summary',
            params: { consultationId, doctorId, doctorName, consultationType: 'video' },
          })
        },
      },
    ])
  }

  // Ring pulse animation
  const ringPulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(ringPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  // ── WAITING FOR DOCTOR SCREEN ───────────────────────────────────────────────
  if (callStatus === 'waiting_for_doctor') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.waitingDoctorScreen}>
          <View style={styles.waitingBadge}>
            <ActivityIndicator size="small" color="#7C3AED" />
            <Text style={styles.waitingBadgeText}>Waiting for Doctor</Text>
          </View>
          <View style={styles.waitingCenter}>
            <View style={styles.waitingAvatarWrap}>
              {doctorPhotoUrl
                ? <Image source={{ uri: doctorPhotoUrl }} style={styles.waitingPhoto} />
                : <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
              }
            </View>
            <Text style={styles.waitingDoctorName}>{doctorName ?? 'Doctor'}</Text>
            <Text style={styles.waitingSubtitle}>The doctor will call you shortly…</Text>
            <Text style={styles.waitingHint}>Your video call will start automatically when the doctor joins.</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.waitingLeaveBtn, pressed && { opacity: 0.82 }]}
            onPress={() => router.replace('/(patient)/(tabs)/appointments' as any)}
          >
            <Text style={styles.waitingLeaveBtnText}>Leave Waiting Room</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  // ── Ringing / Incoming Call Screen ──────────────────────────────────────
  if (callStatus === 'ringing') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.ringScreen}>
          <View style={styles.ringTypeBadge}>
            <Ionicons name="videocam" size={13} color="#7C3AED" />
            <Text style={[styles.ringTypeBadgeText, { color: '#7C3AED' }]}>Incoming Video Consultation</Text>
          </View>

          <View style={styles.ringCenter}>
            <Animated.View style={[styles.ringOuter, { transform: [{ scale: ringPulse }] }]}>
              <View style={styles.ringInner}>
                <View style={styles.ringAvatarCircle}>
                  {doctorPhotoUrl ? (
                    <Image source={{ uri: doctorPhotoUrl }} style={styles.ringAvatarPhoto} />
                  ) : (
                    <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
                  )}
                </View>
              </View>
            </Animated.View>

            <Text style={styles.ringName}>{doctorName ?? 'Doctor'}</Text>
            <Text style={styles.ringSubtitle}>is calling you…</Text>
            <Text style={styles.ringNote}>Tap Answer to join · Decline to go back</Text>
            <Text style={styles.ringCountdown}>Auto-declining in {ringCountdown}s</Text>
          </View>

          <View style={styles.ringActions}>
            <ConsultationActionButtons
              onDecline={handleDecline}
              onAccept={handleAnswer}
              declineLabel="Decline"
              acceptLabel="Answer"
              size={80}
            />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Active Video Call Screen ─────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Remote video (full screen) */}
      <View style={styles.mainVideo}>
        {agoraReady && remoteUid && RtcSurfaceView ? (
          <RtcSurfaceView canvas={{ uid: remoteUid }} style={styles.fullFill} />
        ) : (
          <View style={styles.videoPlaceholder}>
            {doctorPhotoUrl ? (
              <Image source={{ uri: doctorPhotoUrl }} style={styles.videoPlaceholderPhoto} />
            ) : (
              <Ionicons name="person" size={72} color="rgba(255,255,255,0.2)" />
            )}
            <Text style={styles.videoPlaceholderText}>{doctorName ?? 'Doctor'}</Text>
            {tokenFetchFailed ? (
              <Pressable
                onPress={() => setTokenRetryKey(k => k + 1)}
                style={{ marginTop: 4, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}
              >
                <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#FCA5A5' }}>Connection failed — tap to retry</Text>
              </Pressable>
            ) : (
              <Text style={styles.videoNote}>
                {callStatus === 'reconnecting' ? 'Doctor reconnecting…' :
                 callStatus === 'waiting' ? 'Waiting for doctor to join…' : 'Connecting…'}
              </Text>
            )}
          </View>
        )}

        {/* Top overlay: LIVE + network quality + timer */}
        <View style={styles.topOverlay}>
          <View style={[styles.liveChip, callStatus === 'reconnecting' && styles.liveChipWarning]}>
            <View style={[styles.liveDot, callStatus === 'reconnecting' && styles.liveDotWarning]} />
            <Text style={styles.liveText}>{callStatus === 'reconnecting' ? 'RECONNECTING' : 'LIVE'}</Text>
          </View>
          {callStatus === 'connected' && networkQuality > 0 && (
            <View style={styles.netQualityChip}>
              <Ionicons
                name="wifi"
                size={12}
                color={networkQuality <= 2 ? '#4ADE80' : networkQuality <= 4 ? '#FBBF24' : '#F87171'}
              />
              <Text style={[styles.netQualityText, {
                color: networkQuality <= 2 ? '#4ADE80' : networkQuality <= 4 ? '#FBBF24' : '#F87171'
              }]}>
                {networkQuality <= 2 ? 'Excellent' : networkQuality <= 4 ? 'Good' : 'Poor'}
              </Text>
            </View>
          )}
          <Text style={styles.timerOverlay}>
            {callStatus === 'connected' ? formatTime(seconds) : callStatus === 'reconnecting' ? 'Reconnecting…' : '--:--'}
          </Text>
        </View>

        {/* Reconnect countdown */}
        {callStatus === 'reconnecting' && (
          <View style={styles.reconnectOverlay}>
            <ActivityIndicator size="small" color="#FBBF24" style={{ marginRight: 8 }} />
            <Text style={styles.reconnectText}>Reconnecting…</Text>
          </View>
        )}

        {/* Remote muted badge */}
        {remoteMuted && callStatus === 'connected' && (
          <View style={styles.remoteMutedBadge}>
            <Ionicons name="mic-off" size={12} color="#FBBF24" />
            <Text style={styles.remoteMutedText}>Doctor is muted</Text>
          </View>
        )}

        {/* Self view — bottom right */}
        {!selfViewHidden && (
          <Pressable style={styles.selfView} onPress={() => setSelfViewHidden(true)}>
            {agoraReady && !cameraOff && RtcSurfaceView ? (
              <RtcSurfaceView canvas={{ uid: 0, sourceType: VideoSourceCamera }} style={styles.fullFill} />
            ) : (
              <View style={styles.selfViewOff}>
                <Ionicons name={cameraOff ? 'videocam-off' : 'person'} size={22} color="rgba(255,255,255,0.5)" />
              </View>
            )}
            <Text style={styles.selfLabel}>You</Text>
          </Pressable>
        )}

        {selfViewHidden && (
          <Pressable style={styles.showSelfBtn} onPress={() => setSelfViewHidden(false)}>
            <Text style={styles.showSelfText}>Show self view</Text>
          </Pressable>
        )}
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.controlsRow}>
          <ControlButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} active={muted} disabled={isConnecting} onPress={toggleMute} />
          <ControlButton icon={speakerOn ? 'volume-high' : 'volume-medium'} label="Speaker" active={speakerOn} disabled={isConnecting} onPress={() => setSpeakerOn(s => !s)} />
          <ControlButton icon={cameraOff ? 'videocam-off' : 'videocam'} label={cameraOff ? 'Cam Off' : 'Camera'} active={cameraOff} disabled={isConnecting} onPress={() => setCameraOff(c => !c)} />
          <ControlButton icon="camera-reverse" label="Switch" disabled={isConnecting} onPress={handleSwitchCamera} />
          <View>
            <ControlButton icon="chatbubble-ellipses" label="Chat" active={chatOpen} disabled={isConnecting} onPress={chatOpen ? closeChat : openChat} />
            {unreadCount > 0 && !chatOpen && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <ControlButton icon="information-circle" label="Info" active={showInfoSheet} disabled={isConnecting} onPress={() => setShowInfoSheet(v => !v)} />
          <Pressable style={styles.endBtn} onPress={handleEnd}>
            <Ionicons name="call" size={28} color={colors.mistWhite} style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={styles.endLabel}>End</Text>
          </Pressable>
        </View>
      </View>

      {/* Info bottom sheet */}
      <CallInfoPanel
        visible={showInfoSheet}
        onClose={() => setShowInfoSheet(false)}
        consultationId={consultationId}
        consultationType="video"
        counterpartLabel="Doctor"
        counterpartName={formatDoctorName(doctorName)}
        counterpartPhotoUrl={doctorPhotoUrl}
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

function ControlButton({ icon, label, active, disabled = false, onPress }: { icon: string; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.ctrlBtn,
        active && styles.ctrlBtnActive,
        disabled && styles.ctrlBtnDisabled,
        pressed && !disabled && { opacity: 0.8 },
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
      <Text style={[styles.ctrlLabel, disabled && styles.ctrlLabelDisabled]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  fullFill: { flex: 1 },

  // ── Waiting for doctor screen ─────────────────────────────────────────────
  waitingDoctorScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, paddingHorizontal: 24,
  },
  waitingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(124,58,237,0.15)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)',
  },
  waitingBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#7C3AED' },
  waitingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  waitingAvatarWrap: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(124,58,237,0.4)', overflow: 'hidden', marginBottom: 8,
  },
  waitingPhoto: { width: '100%', height: '100%' },
  waitingDoctorName: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite, textAlign: 'center' },
  waitingSubtitle: { fontFamily: fonts.medium, fontSize: 15, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 8 },
  waitingHint: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 20 },
  waitingLeaveBtn: {
    height: 50, paddingHorizontal: 32, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  waitingLeaveBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: 'rgba(255,255,255,0.7)' },

  // ── Ringing screen ──────────────────────────────────────────────────────
  ringScreen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24 },
  ringTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(124,58,237,0.15)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  ringTypeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },
  ringCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  ringOuter: {
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(124,58,237,0.08)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  ringInner: {
    width: 165, height: 165, borderRadius: 83,
    backgroundColor: 'rgba(124,58,237,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  ringAvatarCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#7C3AED', overflow: 'hidden',
  },
  ringAvatarPhoto: { width: '100%', height: '100%' },
  ringName: { fontFamily: fonts.bold, fontSize: 28, color: colors.mistWhite, textAlign: 'center' },
  ringSubtitle: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(255,255,255,0.55)' },
  ringNote: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 20 },
  ringCountdown: { fontFamily: fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  ringActions: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 40 },

  // ── Active video call ───────────────────────────────────────────────────
  mainVideo: { flex: 1, position: 'relative' },
  videoPlaceholder: { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', gap: 12 },
  videoPlaceholderPhoto: { width: 120, height: 120, borderRadius: 60 },
  videoPlaceholderText: { fontFamily: fonts.bold, fontSize: 22, color: 'rgba(255,255,255,0.6)' },
  videoNote: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.3)' },

  topOverlay: {
    position: 'absolute', top: 50, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20,
  },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
  },
  liveChipWarning: { backgroundColor: 'rgba(251,191,36,0.2)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveDotWarning: { backgroundColor: '#FBBF24' },
  liveText: { fontFamily: fonts.bold, fontSize: 12, color: colors.mistWhite, letterSpacing: 1 },
  timerOverlay: {
    fontFamily: fonts.medium, fontSize: 16, color: colors.mistWhite,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
  },

  netQualityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6,
  },
  netQualityText: { fontFamily: fonts.medium, fontSize: 11 },

  remoteMutedBadge: {
    position: 'absolute', bottom: 110, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 5,
  },
  remoteMutedText: {
    fontFamily: fonts.medium, fontSize: 12, color: '#FBBF24',
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },

  reconnectOverlay: {
    position: 'absolute', bottom: 110, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  reconnectText: { fontFamily: fonts.medium, fontSize: 13, color: '#FDE68A' },

  selfView: {
    position: 'absolute', bottom: 20, right: 20,
    width: 90, height: 120, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: colors.mistWhite,
    alignItems: 'center', justifyContent: 'flex-end',
  },
  selfViewOff: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center',
  },
  selfLabel: {
    fontFamily: fonts.medium, fontSize: 10, color: colors.mistWhite,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4, width: '100%', textAlign: 'center',
  },
  showSelfBtn: {
    position: 'absolute', bottom: 20, right: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  showSelfText: { fontFamily: fonts.medium, fontSize: 11, color: colors.mistWhite },

  // paddingBottom is overridden inline with the device safe-area inset added — see JSX.
  controls: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.85)' },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  ctrlBtn: { alignItems: 'center', gap: 5, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  ctrlBtnActive: { backgroundColor: '#374151' },
  ctrlBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)' },
  ctrlLabel: { fontFamily: fonts.medium, fontSize: 9, color: 'rgba(255,255,255,0.7)' },
  ctrlLabelDisabled: { color: 'rgba(255,255,255,0.25)' },
  endBtn: { alignItems: 'center', gap: 5, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.error, justifyContent: 'center', shadowColor: colors.error, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  endLabel: { fontFamily: fonts.bold, fontSize: 9, color: colors.mistWhite },

  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#0A0A0A',
  },
  unreadBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },
})
