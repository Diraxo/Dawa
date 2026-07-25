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
  Linking,
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
const OrientationModeAdaptive = 0        // OrientationMode.OrientationModeAdaptive
const RenderModeFit = 2             // RenderModeType.RenderModeFit — show the full frame, never crop
const DegradationMaintainBalanced = 2    // DegradationPreference.MaintainBalanced
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
import { submitConsultationCompletion } from '@/lib/consultationCompletion'
import { CallInfoPanel } from '@/components/consultation/CallInfoPanel'
import { InCallChatPanel } from '@/components/consultation/InCallChatPanel'
import { CallHeader, ConnectionStatus } from '@/components/consultation/CallHeader'
import { DraggableSelfView } from '@/components/consultation/DraggableSelfView'
import { SpeakingPulse } from '@/components/consultation/SpeakingPulse'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import * as ImagePicker from 'expo-image-picker'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { getPersistedCameraOff, setPersistedCameraOff, clearPersistedCameraOff } from '@/lib/callCameraStorage'
import { streamClient, watchConsultationChannel } from '@/lib/stream'
import { supabase, getAuthClient } from '@/lib/supabase'
import { markNotificationsReadForConsultation } from '@/lib/notificationCenter'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'
import { logger } from '@/lib/logger'
import { localizeNotificationPhoto } from '@/lib/notificationPhoto'

const GRACE_PERIOD_MS = 90_000
const CONNECTION_TIMEOUT_MS = 90_000
// Agora volume is 0-255 — treat anything above this as "currently speaking"
// for the speaking-indicator pulse.
const SPEAKING_VOLUME_THRESHOLD = 20

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
  const { setActive, updateElapsed, updateIdentity, updateCallStartedAt, setConnectionStatus } = useActiveConsultationStore()

  // Auto-clear: reaching this call screen at all — whether via the
  // notification, the OS call UI, or the in-app queue — means the
  // corresponding notification has been handled; mark it read.
  useEffect(() => {
    if (!consultationId || !userId) return
    markNotificationsReadForConsultation(supabase, userId, consultationId)
  }, [consultationId, userId])

  ScreenCapture.usePreventScreenCapture()

  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Driven by Agora's audio volume indication — who's currently talking, for
  // the speaking-indicator pulse (self view when it's the doctor, the
  // patient's avatar/video area when it's the patient).
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const [remoteSpeaking, setRemoteSpeaking] = useState(false)
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  // Patient turned their camera off — show the avatar placeholder instead of
  // a frozen last frame; RtcSurfaceView keeps rendering the last-received
  // frame otherwise since Agora stops sending new ones, not the view itself.
  const [remoteCamOff, setRemoteCamOff] = useState(false)
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

  // Keeps the always-current camera intent so it can be re-applied the
  // instant a new engine joins, mirroring mutedRef below.
  const camOffRef = useRef(camOff)
  useEffect(() => { camOffRef.current = camOff }, [camOff])
  const toggleCamera = () => {
    setCamOff(c => {
      const next = !c
      setPersistedCameraOff(consultationId, next)
      return next
    })
  }

  // Load any previously-chosen mute state for this consultation before the
  // first join, so a refresh/app-restart mid-call resumes muted. The join
  // effect below waits on `muteLoaded` so the very first joinChannel already
  // publishes with the correct mute state.
  const [muteLoaded, setMuteLoaded] = useState(false)
  // Same for camera-off — without this, "camera off" reset itself to "on"
  // every time the screen remounted (rejoin, app kill/relaunch resume, web
  // refresh) since camOff was a bare useState(false) with no persistence.
  const [camStateLoaded, setCamStateLoaded] = useState(false)
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null && muteLoaded && camStateLoaded
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
  useEffect(() => {
    if (!consultationId) { setCamStateLoaded(true); return }
    let cancelled = false
    getPersistedCameraOff(consultationId).then(persisted => {
      if (cancelled) return
      if (persisted) { camOffRef.current = true; setCamOff(true) }
      setCamStateLoaded(true)
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

  const setActiveConsultationId = useActiveConsultationScreenStore((s) => s.setActiveConsultationId)
  // Tracked so usePushNotifications.ts's foreground handler can suppress a
  // consultation push (e.g. "Patient Joined") that arrives after this call
  // is already open.
  useEffect(() => {
    if (!channelName) return
    setActiveConsultationId(channelName)
    return () => setActiveConsultationId(null)
  }, [channelName, setActiveConsultationId])

  const phaseRef = useRef(state.phase)
  useEffect(() => { phaseRef.current = state.phase }, [state.phase])
  const seconds = state.elapsedSeconds ?? 0
  const startedAtIso = state.startedAtIso
  // Distinguishes "patient tapped Leave Call" (still in_progress, patient may
  // rejoin) from a genuine network drop — both surface as callStatus
  // 'reconnecting' below, but should read very differently to the doctor.
  const patientHasLeft = state.patientHasLeft
  // `remoteUid` gates 'connected' too, not just phase — the DB-driven phase
  // only proves each side's OWN join succeeded (markSelfConnected), not that
  // this client has actually observed the patient's peer. Without this, the
  // timer/LIVE badge could run while the video area is still showing the
  // "Connecting…" placeholder — a running timer over a black screen.
  const callStatus: CallStatus = localError
    ? 'error'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? (remoteUid !== null ? 'connected' : 'connecting')
    : state.phase === 'waiting_for_patient'
    ? 'waiting'
    : 'connecting'

  // Header/timer connection status — deliberately driven ONLY by the
  // DB-derived `state.phase` (identical on both clients via the same
  // Realtime row), not by this device's local `remoteUid`/video-arrival
  // signal used above for `callStatus`. That local gate is correct for
  // deciding what the video area renders (placeholder vs. live stream) but
  // is inherently asymmetric between the two clients — each side learns of
  // the other's video at a slightly different time — which is exactly what
  // caused the doctor and patient screens to disagree on "Connecting" vs
  // "Connected" and run out-of-sync timers. `localError` is the one
  // legitimate local-only override: it reflects this device's own Agora
  // session having genuinely failed, not a difference in how the same
  // reality is being reported.
  const connectionStatus: ConnectionStatus = localError
    ? 'disconnected'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? 'connected'
    : 'connecting'

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chatOpenRef = useRef(false)

  // Sends a heartbeat UPDATE to consultations.last_heartbeat_at every 30s
  // while connected, so the server-side stale-consultation cleanup can tell
  // a crashed mobile call apart from a genuinely long-running one.
  // Also active during 'reconnecting' — the server-side stale-session cron
  // (mark_stale_active_consultations, migration 023) kills any in_progress
  // call whose heartbeat has gone quiet for 10 minutes. Pausing the
  // heartbeat the instant the patient drops (their onUserOffline flips this
  // client into 'reconnecting') means any patient network blip, backgrounded
  // app, or dead phone lasting past 10 minutes gets the whole consultation
  // silently ended_abnormally out from under the doctor, even though the
  // doctor never gave up. Matches the web doctor pages' equivalent fix.
  useHeartbeat(consultationId, callStatus === 'connected' || callStatus === 'reconnecting')

  // This screen is always reached via router.push (incoming-request accept,
  // Home, Consultations, a notification deep link), so a prior screen is
  // normally already on the stack — router.back() pops straight back to that
  // already-mounted instance. router.replace() instead pushes a *second*,
  // brand-new (tabs) navigator instance on top of the existing one (replace
  // swaps only the current stack entry, it doesn't reuse an earlier matching
  // one further down), leaving the original — with Home's realtime
  // subscriptions/poll interval still live — orphaned underneath,
  // permanently mounted and invisible. Every call taken during a session
  // leaked one more orphaned tabs instance this way. Only cold-start/deep-
  // link entry (no prior screen) has nothing to pop to.
  const goToConsultations = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(doctor)/(tabs)/consultations' as any)
  }

  // Single source of truth for the "call ended" reaction — release Agora
  // resources exactly once, then navigate away. Doctor gets no completion
  // modal (a deliberate, preserved asymmetry vs. the patient side); the
  // rawStatus-branched Alert.alert copy stays screen-specific since it's UI
  // text, not detection/teardown logic.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'doctor',
    kind: 'video',
    consultationId,
    onTeardown: () => {
      try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel() } catch {}
      releaseAgoraEngine()
      setActive(null)
      if (state.rawStatus === 'call_declined') {
        Alert.alert('Call Declined', 'The patient has declined the call.', [
          { text: 'OK', onPress: goToConsultations },
        ])
      } else if (state.rawStatus === 'missed') {
        Alert.alert('Missed Call', 'The patient did not answer the call.', [
          { text: 'OK', onPress: goToConsultations },
        ])
      } else {
        Alert.alert('Call Ended', 'The consultation has ended.', [
          { text: 'OK', onPress: goToConsultations },
        ])
      }
    },
  })

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

  // Keeps the Resume banner / Android notification's name+photo current —
  // the initial setActive() above only runs once at mount (before the async
  // live-profile fetch resolves), so without this a mid-call rename/photo
  // change (or simply a slow first fetch) stays wrong for the rest of the call.
  useEffect(() => { updateIdentity(displayName, patientPhotoUrl) }, [displayName, patientPhotoUrl])

  // Anchors the Android ongoing-call notification's chronometer to the real
  // DB started_at instead of a snapshot of elapsedSeconds taken before it
  // was known — see hooks/useOngoingConsultationNotification.ts.
  useEffect(() => { updateCallStartedAt(state.callStartedAtMs ?? null) }, [state.callStartedAtMs])

  useEffect(() => {
    setConnectionStatus(connectionStatus === 'reconnecting' ? 'reconnecting' : connectionStatus === 'connected' ? 'active' : 'connecting')
  }, [connectionStatus])

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
                title: `Video Consultation with ${displayName}`,
                body: `Tap to return to your video consultation with ${displayName}`,
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

      gracePeriodRef.current = setTimeout(() => {
        if (!mounted) return
        // Network issues must never end the consultation — only an explicit
        // End Consultation / Decline / Cancel action may. Keep reconnecting
        // indefinitely; the doctor can still explicitly end the call.
        logger.warn('[Video][Doctor] Grace period elapsed — still reconnecting, not ending call')
        startGracePeriod()
      }, GRACE_PERIOD_MS)
    }

    const handler = {
      onJoinChannelSuccess: (connection: any) => {
        logger.log(`[Video][Doctor][${Date.now()}] onJoinChannelSuccess channel:${connection?.channelId} uid:${connection?.localUid}`)
        // Re-apply the user's chosen mute/camera state to the (possibly
        // brand-new, post-retry) engine — a fresh join always defaults to
        // unmuted/camera-on.
        try { engine?.muteLocalAudioStream(mutedRef.current) } catch {}
        try { engine?.muteLocalVideoStream(camOffRef.current) } catch {}
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
        // A prior local Agora error (onError/CONNECTION_STATE_FAILED) must
        // not permanently latch the UI into 'error' once the peer is
        // actually back — doctor phone/patient phone already clear this on
        // reconnect; video never did, leaving a frozen "Connection Lost"
        // banner even after a real recovery.
        setLocalError(false)
        setRemoteMuted(false)
        setRemoteCamOff(false)
        clearGracePeriod()
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      },
      onUserOffline: (_conn: any, uid: number, reason: number) => {
        logger.log(`[Video][Doctor][${Date.now()}] onUserOffline uid:${uid} reason:${reason}`)
        if (!mounted || uid !== remoteUidRef.current) return
        // Immediate — no debounce. The avatar placeholder is always a safe
        // fallback (it's what a mute/camera-off already shows), so there is
        // no flicker risk in swapping to it right away; a quick reconnect
        // just swaps back to live video the instant onUserJoined fires.
        remoteUidRef.current = null
        setRemoteUid(null)
        setIsReconnecting(true)
        startGracePeriod()
      },
      // Mirrors onRemoteAudioStateChanged — reason 5/6 = REMOTE_MUTED/REMOTE_UNMUTED.
      // Without this, toggling the patient's camera off left RtcSurfaceView
      // rendering its last-received frame forever (Agora just stops sending
      // new ones; the view itself doesn't know to fall back to a placeholder).
      onRemoteVideoStateChanged: (_conn: any, uid: number, _state: number, reason: number) => {
        if (!mounted) return
        if (reason === 5) setRemoteCamOff(true)
        else if (reason === 6) setRemoteCamOff(false)
      },
      onRemoteAudioStateChanged: (_conn: any, uid: number, _state: number, reason: number) => {
        if (!mounted) return
        if (reason === 5) {
          setRemoteMuted(true)
        } else if (reason === 6) {
          setRemoteMuted(false)
        }
      },
      onNetworkQuality: (_uid: any, txQuality: number, rxQuality: number) => {
        if (mounted) setNetworkQuality(Math.max(txQuality, rxQuality) as any)
      },
      // uid 0 = local speaker in this callback specifically (per Agora's own
      // AudioVolumeInfo docs); any other uid is the patient's peer. Drives
      // the speaking-indicator pulse on the self view / patient avatar.
      onAudioVolumeIndication: (_conn: any, speakers: any[], _speakerNumber: number, _totalVolume: number) => {
        if (!mounted || !speakers) return
        let local = false
        let remote = false
        for (const s of speakers) {
          const speaking = (s?.volume ?? 0) > SPEAKING_VOLUME_THRESHOLD
          if (s?.uid === 0) local = local || speaking
          else remote = remote || speaking
        }
        setLocalSpeaking(local)
        setRemoteSpeaking(remote)
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
        const { status, canAskAgain: micCanAskAgain } = await Audio.requestPermissionsAsync()
        if (!mounted) return
        if (status !== 'granted') {
          Alert.alert(
            'Microphone Required',
            'Dawa needs microphone access to join this consultation. Please allow it to continue.',
            micCanAskAgain
              ? [{ text: 'OK' }]
              : [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]
          )
          setLocalError(true)
          return
        }

        // Camera permission is never implicitly requested by the Agora SDK —
        // without this, native camera capture silently fails (audio-only)
        // with no prompt and no error. Reuses expo-image-picker (already a
        // dependency) rather than adding a new native module.
        let cameraGranted = false
        let cameraCanAskAgain = true
        try {
          const existing = await ImagePicker.getCameraPermissionsAsync()
          cameraGranted = existing.status === 'granted'
          cameraCanAskAgain = existing.canAskAgain
          if (!cameraGranted && existing.canAskAgain) {
            const requested = await ImagePicker.requestCameraPermissionsAsync()
            cameraGranted = requested.status === 'granted'
            cameraCanAskAgain = requested.canAskAgain
          }
        } catch (permErr) {
          logger.error('[Video][Doctor] Camera permission check failed:', permErr)
        }
        if (!mounted) return
        if (!cameraGranted) {
          Alert.alert(
            'Camera Required',
            'Camera access is required for video calls. You can continue with audio only for now.',
            cameraCanAskAgain
              ? [{ text: 'OK' }]
              : [
                  { text: 'Continue with Audio Only', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]
          )
          camOffRef.current = true
          setCamOff(true)
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
        })
        if (!mounted) return

        engine!.enableAudio()
        // Speaking-indicator pulse — 300ms updates, smoothed over 3 samples,
        // with local voice-activity detection enabled.
        try { engine!.enableAudioVolumeIndication(300, 3, true) } catch {}
        // Agora's own RtcSurfaceView docs (see AgoraRtcRenderView.d.ts) state
        // that, before joining a channel, startPreview() must be called
        // BEFORE enableVideo() for the local preview canvas to bind frames —
        // the reverse order leaves the local RtcSurfaceView (uid 0) canvas
        // unbound. Publishing doesn't depend on this ordering (which is why
        // the remote side always received the camera feed fine), only the
        // local render pipeline does. Only touch the camera hardware if
        // permission was actually granted.
        if (cameraGranted) engine!.startPreview()
        engine!.enableVideo()
        // 960x540 @ 24fps, adaptive orientation, balanced degradation — HD
        // baseline that the SDK adapts down under poor network conditions
        // rather than defaulting to a fixed low-quality profile.
        // MaintainBalanced (not the deprecated MaintainQuality) requires
        // orientationMode: OrientationModeAdaptive to take effect.
        try {
          engine!.setVideoEncoderConfiguration({
            dimensions: { width: 960, height: 540 },
            frameRate: 24,
            bitrate: 0, // STANDARD_BITRATE — SDK auto-picks/adapts based on network
            orientationMode: OrientationModeAdaptive,
            degradationPreference: DegradationMaintainBalanced,
          })
        } catch {}
        // AudioProfileDefault (0) + AudioScenarioMeeting (8) — tuned for a
        // 1:1 voice-centric consultation (vs. the SDK's generic default).
        try { engine!.setAudioProfile(0, 8) } catch {}
        engine!.muteLocalAudioStream(mutedRef.current)
        try { engine!.muteLocalVideoStream(camOffRef.current) } catch {}
        engine!.setEnableSpeakerphone(true)
        if (proxyFallbackRef.current) engine!.setCloudProxy(3)

        logger.log(`[Video][Doctor][${Date.now()}] joinChannel → channel:${channelName} uid:${localUid} tokenLen:${agoraToken?.length ?? 0} proxy:${proxyFallbackRef.current} cameraGranted:${cameraGranted}`)
        const code = engine!.joinChannel(agoraToken ?? '', channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: cameraGranted,
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
      let watchedChannel: Awaited<ReturnType<typeof watchConsultationChannel>> | null = null
      let msgSub: { unsubscribe: () => void } | null = null
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
          if (cancelled) { ch.stopWatching().catch(() => {}); return }
          watchedChannel = ch
          setActiveChannel(ch)
          // Seed from Stream's own persisted unread state (not just messages
          // that arrive after this listener attaches) so a badge survives a
          // remount/refresh instead of always starting back at 0.
          if (chatOpenRef.current) {
            ch.markRead().catch(() => {})
          } else {
            setUnreadCount(ch.countUnread())
          }
          msgSub = ch.on('message.new', () => {
            if (!chatOpenRef.current) setUnreadCount(c => c + 1)
            else ch.markRead().catch(() => {})
          })
        } catch (err) {
          logger.error('[DoctorVideoChat] watch failed:', err)
        } finally {
          if (!cancelled) setChannelLoading(false)
        }
      })()
      // Watched channels and their listeners live on the module-level
      // streamClient singleton, not this component — without this, every
      // call taken during a session leaks one more watched channel + listener.
      return () => {
        cancelled = true
        msgSub?.unsubscribe()
        watchedChannel?.stopWatching().catch(() => {})
      }
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

  const handleEndSubmit = async (data: any) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (token && consultationId) {
        const client = getAuthClient(token)
        const result = await submitConsultationCompletion({
          client, consultationId, data, durationMinutes: Math.ceil(seconds / 60),
        })
        if (!result.ok) {
          logger.error('[Video][Doctor] completion failed at stage:', result.failedAt)
          setSubmitting(false)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
      }
    } catch (err) {
      logger.error('[Video][Doctor] save summary failed:', err)
      setSubmitting(false)
      Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
      return
    }
    setSubmitting(false)
    completion.markHandled()
    try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
    clearPersistedMute(consultationId)
    clearPersistedCameraOff(consultationId)
    setShowEndSheet(false)
    setActive(null)
    goToConsultations()
  }

  const handleEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    // Gate on the DB-derived phase, not `callStatus` — callStatus also folds
    // in this client's own local Agora error/connection-quality state
    // (`localError`, `remoteUid`), which must never determine whether the
    // doctor can complete a consultation that the server already recorded as
    // started. Once the DB says the call reached in_progress, End
    // Consultation (and the summary form) must always be reachable,
    // regardless of the patient's presence or a local network hiccup.
    // 'waiting_for_patient' is also treated as active: it only occurs once
    // the doctor has actually joined the channel (doctor_connected_at is
    // set) and is purely waiting on a patient who is offline or stuck
    // connecting — that is a real consultation attempt, not an unplaced
    // outgoing call, so the doctor must be able to end it with a summary
    // rather than being routed into the "Cancel Call" abandon flow.
    const isCallActive = state.phase === 'on_call' || state.phase === 'reconnecting' || state.phase === 'waiting_for_patient'
    if (!isCallActive) {
      // In 'waiting' (ringing) or 'connecting' — cancel the outgoing call
      Alert.alert('Cancel Call', 'Cancel this outgoing call?', [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Cancel Call', style: 'destructive',
          onPress: () => {
            try { getAgoraEngine()?.stopPreview(); getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
            setActive(null)
            goToConsultations()
          },
        },
      ])
      return
    }
    setShowEndSheet(true)
  }

  const isConnecting = callStatus === 'connecting'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => !submitting && setShowEndSheet(false)}
        />
      )}

      {/* Patient video (full screen) */}
      <View style={styles.mainVideo}>
        {agoraReady && remoteUid && !remoteCamOff && !isReconnecting && RtcSurfaceView ? (
          <RtcSurfaceView canvas={{ uid: remoteUid, renderMode: RenderModeFit }} style={styles.fullFill} />
        ) : (
          <View style={styles.patientVideoPlaceholder}>
            <SpeakingPulse active={remoteSpeaking && callStatus === 'connected'} borderRadius={64}>
              {patientPhotoUrl ? (
                <Image source={{ uri: patientPhotoUrl }} style={styles.patientVideoPlaceholderImage} />
              ) : (
                <Ionicons name="person" size={80} color="rgba(255,255,255,0.15)" />
              )}
            </SpeakingPulse>
            <Text style={styles.patientVideoName}>{displayName}</Text>
            {tokenFetchFailed ? (
              <Pressable
                onPress={() => setTokenRetryKey(k => k + 1)}
                style={{ marginTop: 4, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}
              >
                <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#FCA5A5' }}>Connection failed — tap to retry</Text>
              </Pressable>
            ) : callStatus === 'connected' && remoteCamOff ? null : (
              <Text style={styles.patientVideoSub}>
                {callStatus === 'reconnecting' ? (patientHasLeft ? 'Patient has left the consultation' : 'Patient reconnecting…') :
                 callStatus === 'waiting' ? 'Waiting for patient…' : 'Connecting…'}
              </Text>
            )}
          </View>
        )}

        {/* Shared header: timer/status (row 1, driven by the DB-derived
            connectionStatus, identical on both clients) + chat/switch-camera
            below it, participant chip centered, info button below status. */}
        <CallHeader
          elapsedSeconds={seconds}
          connectionStatus={connectionStatus}
          counterpartName={displayName}
          counterpartPhotoUrl={patientPhotoUrl}
          onChatPress={chatOpen ? closeChat : openChat}
          chatActive={chatOpen}
          unreadCount={unreadCount}
          onSwitchCamera={() => {
            const engine = getAgoraEngine()
            try { engine?.switchCamera() } catch {}
          }}
          onInfoPress={() => setShowInfoSheet(true)}
          disabled={isConnecting}
        />

        {/* Reconnect overlay — distinguishes a genuine network drop from the
            patient having tapped Leave Call (calm/informational, not a warning
            or error, since the consultation is still active). */}
        {callStatus === 'reconnecting' && (
          <View style={[styles.reconnectOverlay, patientHasLeft && styles.reconnectOverlayInfo]}>
            {patientHasLeft ? (
              <Ionicons name="information-circle-outline" size={16} color={colors.information} style={{ marginRight: 8 }} />
            ) : (
              <ActivityIndicator size="small" color="#FBBF24" style={{ marginRight: 8 }} />
            )}
            <Text style={[styles.reconnectText, patientHasLeft && styles.reconnectTextInfo]}>
              {patientHasLeft ? 'Patient has left the consultation' : 'Reconnecting…'}
            </Text>
          </View>
        )}

        {/* Remote muted badge */}
        {remoteMuted && callStatus === 'connected' && (
          <View style={styles.remoteMutedBadge}>
            <Ionicons name="mic-off" size={13} color="#FDE68A" />
            <Text style={styles.remoteMutedText}>Patient muted</Text>
          </View>
        )}

        {/* Doctor self-view — draggable, WhatsApp-style floating PiP, starts
            top-right below the header (chat/switch-camera row). */}
        <DraggableSelfView
          top={118}
          canvas={{ uid: 0, sourceType: VideoSourceCamera, renderMode: RenderModeFit }}
          isOff={!(agoraReady && !camOff && RtcSurfaceView)}
          isSpeaking={localSpeaking}
        />
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
            icon={camOff ? 'videocam-off' : 'videocam'}
            label={camOff ? 'Cam On' : 'Video'}
            active={camOff}
            disabled={isConnecting}
            onPress={toggleCamera}
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
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Ionicons
        name={icon as any}
        size={20}
        color={disabled ? 'rgba(0,0,0,0.2)' : active ? colors.mistWhite : colors.inkBlack}
      />
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

  reconnectOverlay: {
    position: 'absolute', bottom: 100, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  reconnectText: { fontFamily: fonts.medium, fontSize: 13, color: '#FDE68A' },
  reconnectOverlayInfo: { backgroundColor: 'rgba(2,136,209,0.15)', borderColor: 'rgba(2,136,209,0.4)' },
  reconnectTextInfo: { color: '#7DD3FC' },

  remoteMutedBadge: { position: 'absolute', top: 132, left: 0, right: 0, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 },
  remoteMutedText: { fontFamily: fonts.medium, fontSize: 12, color: '#FDE68A' },

  // paddingBottom is overridden inline with the device safe-area inset added — see JSX.
  controls: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ctrlBtn: { alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)' },
  ctrlBtnActive: { backgroundColor: colors.careBlue },
  ctrlBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)' },
  endBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', shadowColor: colors.error, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6, transform: [{ rotate: '135deg' }] },
})
