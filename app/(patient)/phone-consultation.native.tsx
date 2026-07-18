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
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ScreenCapture from 'expo-screen-capture'
import * as Notifications from 'expo-notifications'
import * as Haptics from 'expo-haptics'
import { Audio } from 'expo-av'

const ClientRoleBroadcaster = 1

import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { CallInfoPanel } from '@/components/consultation/CallInfoPanel'
import { InCallChatPanel } from '@/components/consultation/InCallChatPanel'
import { ConsultationCompletedModal } from '@/components/consultation/ConsultationCompletedModal'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { getAuthClient, supabase } from '@/lib/supabase'
import { markNotificationsReadForConsultation } from '@/lib/notificationCenter'
import { streamClient, watchConsultationChannel } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'
import { callkeep } from '@/lib/callkeep'
import { logger } from '@/lib/logger'
import { formatDoctorName } from '@/lib/nameFormat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { formatCallDuration } from '@/lib/callDuration'
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

// Only used here to gate watchConsultationChannel() on availability — the
// actual chat UI now lives entirely in the shared InCallChatPanel.
let Chat: any = null
try {
  Chat = require('stream-chat-expo').Chat
} catch {}

type CallStatus = 'waiting_for_doctor' | 'ringing' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

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
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Ionicons
        name={icon as any}
        size={24}
        color={disabled ? 'rgba(255,255,255,0.25)' : active ? colors.mistWhite : 'rgba(255,255,255,0.85)'}
      />
    </Pressable>
  )
}

const ctrl = StyleSheet.create({
  btn: {
    alignItems: 'center', justifyContent: 'center',
    width: 66, height: 66, borderRadius: 33,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  btnActive: { backgroundColor: colors.careBlue },
  btnDisabled: { backgroundColor: 'rgba(255,255,255,0.04)' },
})

export default function PhoneConsultationScreen() {
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

  // Doctor identity kept live via Realtime — `doctorId` is the doctor's
  // `users.id` (see the doctor_profiles lookup below), so a doctor
  // renaming/replacing their photo mid-call reflects here immediately
  // instead of staying stuck on whatever was passed at navigation time.
  const { name: liveDoctorName, photoUrl: liveDoctorPhotoUrl } = useUserProfileRealtime(
    doctorId ?? null,
    doctorNameParam ?? null,
    doctorPhotoUrlParam ?? null
  )
  const doctorName = liveDoctorName ?? doctorNameParam
  const doctorPhotoUrl = liveDoctorPhotoUrl ?? doctorPhotoUrlParam

  const router = useRouter()
  const { userId, isStreamConnected } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, updateIdentity, updateCallStartedAt, setConnectionStatus } = useActiveConsultationStore()

  // Auto-clear: reaching this call screen at all — whether via the
  // notification, the OS call UI, or waiting-room recovery — means the
  // corresponding notification has been handled; mark it read.
  useEffect(() => {
    if (!consultationId || !userId) return
    markNotificationsReadForConsultation(supabase, userId, consultationId)
  }, [consultationId, userId])

  ScreenCapture.usePreventScreenCapture()

  // fromCallkeep='1' means the patient answered via the OS call screen — skip ringing UI
  // isResume means the patient is returning to an already-in-progress call
  const answeredViaCallkeep = fromCallkeep === '1'
  const isResume = !!resumeElapsed
  const skipRinging = answeredViaCallkeep || isResume

  // Pre-accept-only local UI state — entirely outside the DB-derived call
  // phase, which only ever concerns itself with post-'accepted' status. Once
  // 'answered', displayed call status comes solely from useConsultationState.
  const [ringPhase, setRingPhase] = useState<'waiting_for_doctor' | 'ringing' | 'answered'>(
    skipRinging ? 'answered' : 'ringing'
  )

  const [readyToJoin, setReadyToJoin] = useState(skipRinging)
  const [muted, setMuted] = useState(false)
  const [preMuted, setPreMuted] = useState(false) // muted before answering
  const [speakerOn, setSpeakerOn] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [networkQuality, setNetworkQuality] = useState<0|1|2|3|4|5|6>(0)
  const [ringCountdown, setRingCountdown] = useState(RING_TIMEOUT_SECS)
  const [reconnectCountdown, setReconnectCountdown] = useState(90)
  const [isReconnecting, setIsReconnecting] = useState(false)
  // True once this client has actually observed the doctor's peer join the
  // audio channel — DB phase alone only proves each side's OWN join
  // succeeded, not that the two are actually connected to each other.
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [localError, setLocalError] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)
  const [tokenFetchFailed, setTokenFetchFailed] = useState(false)
  const [tokenRetryKey, setTokenRetryKey] = useState(0)
  const [doctorSpecialty, setDoctorSpecialty] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [showInfoSheet, setShowInfoSheet] = useState(false)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

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
      if (persisted) { mutedRef.current = true; setMuted(true); setPreMuted(true) }
      setMuteLoaded(true)
    })
    return () => { cancelled = true }
  }, [consultationId])

  // Single source of truth for call phase/timer — derived from the DB row via
  // Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: channelName, role: 'patient', localAgoraReconnecting: isReconnecting })

  const setActiveConsultationId = useActiveConsultationScreenStore((s) => s.setActiveConsultationId)
  // Tracked so usePushNotifications.ts's foreground handler can suppress a
  // consultation push (e.g. "Tap to join") that arrives after this call is
  // already open.
  useEffect(() => {
    if (!channelName) return
    setActiveConsultationId(channelName)
    return () => setActiveConsultationId(null)
  }, [channelName, setActiveConsultationId])

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

  // `remoteConnected` gates 'connected' too, not just phase — the DB-driven
  // phase only proves each side's OWN join succeeded (markSelfConnected),
  // not that this client has actually observed the doctor's peer join the
  // audio channel.
  const callStatus: CallStatus = ringPhase === 'waiting_for_doctor'
    ? 'waiting_for_doctor'
    : ringPhase === 'ringing'
    ? 'ringing'
    : localError
    ? 'error'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? (remoteConnected ? 'connected' : 'connecting')
    : state.phase === 'waiting_for_doctor'
    ? 'waiting'
    : 'connecting'

  useHeartbeat(consultationId as string | undefined, callStatus === 'connected')

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null)
  const userOfflineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteMuteActiveRef = useRef(false)
  const ringPulse = useRef(new Animated.Value(1)).current
  const callPulse = useRef(new Animated.Value(1)).current
  const chatOpenRef = useRef(false)

  // Single source of truth for the "call ended" reaction — release Agora
  // resources exactly once, then (patient only) surface the completion
  // dialog, whether the doctor ended the call or it completed/ended
  // abnormally on some other device/session.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'patient',
    kind: 'phone',
    consultationId,
    doctorId,
    doctorName: doctorName ?? doctorNameParam,
    onTeardown: () => {
      try { getAgoraEngine()?.leaveChannel() } catch {}
      releaseAgoraEngine()
      if (consultationId) clearPersistedMute(consultationId)
      setActive(null)
      if (consultationId) callkeep.reportCallEnded(consultationId, 'remoteEnded')
    },
  })

  // ── Fetch doctor specialty ─────────────────────────────────────────────────
  useEffect(() => {
    if (!doctorId) return
    getToken().then(async token => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('doctor_profiles')
        .select('specialty, years_of_experience')
        .eq('user_id', doctorId)
        .maybeSingle()
      if (data?.specialty) {
        setDoctorSpecialty(
          data.years_of_experience
            ? `${data.specialty} • ${data.years_of_experience} yrs exp`
            : data.specialty
        )
      }
    }).catch(() => {})
  }, [doctorId])

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

  // ── Ring pulse animation ───────────────────────────────────────────────────
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

  // ── Call pulse animation ───────────────────────────────────────────────────
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(callPulse, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(callPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

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

  // ── Ring countdown — auto-decline after 60s ────────────────────────────────
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

  // ── Active consultation store ──────────────────────────────────────────────
  useEffect(() => {
    if (!consultationId || ringPhase !== 'answered') return
    setActive({
      consultationId,
      type: 'phone',
      otherPersonName: doctorName ?? 'Doctor',
      otherPersonPhotoUrl: doctorPhotoUrl,
      role: 'patient',
      elapsedSeconds: seconds,
      status: callStatus === 'reconnecting' ? 'reconnecting' : 'active',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, ringPhase])

  useEffect(() => { updateElapsed(seconds) }, [seconds, updateElapsed])

  // Keeps the Resume banner / Android notification's name+photo current —
  // the initial setActive() above only runs once per (consultationId,
  // ringPhase) transition, so without this a mid-call doctor rename/photo
  // change stays wrong for the rest of the call.
  useEffect(() => { updateIdentity(doctorName ?? 'Doctor', doctorPhotoUrl) }, [doctorName, doctorPhotoUrl])

  // Anchors the Android ongoing-call notification's chronometer to the real
  // DB started_at instead of a snapshot of elapsedSeconds taken before it
  // was known — see hooks/useOngoingConsultationNotification.ts.
  useEffect(() => { updateCallStartedAt(state.callStartedAtMs ?? null) }, [state.callStartedAtMs])

  useEffect(() => {
    setConnectionStatus(callStatus === 'reconnecting' ? 'reconnecting' : callStatus === 'connected' ? 'active' : 'connecting')
  }, [callStatus, setConnectionStatus])

  // ── Background notification (iOS only — Android gets the persistent,
  // real-timer Notifee notification from useOngoingConsultationNotification
  // instead, driven globally off the active-consultation store) ────────────
  useEffect(() => {
    if (Platform.OS === 'android') return
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      // Only fire "Ongoing Consultation" when truly connected — not while waiting for the doctor
      if (state === 'background' && (callStatus === 'connected' || callStatus === 'reconnecting')) {
        const localPhotoUri = await localizeNotificationPhoto(doctorPhotoUrl)
        Notifications.scheduleNotificationAsync({
          content: {
            title: `Voice Consultation with ${formatDoctorName(doctorName)}`,
            body: `Tap to return to your voice consultation with ${formatDoctorName(doctorName)}`,
            sound: 'default',
            data: {
              screen: 'consultation',
              consultationId,
              consultationType: 'phone',
              doctorName: doctorName ?? 'Doctor',
              doctorId: doctorId ?? '',
              doctorPhotoUrl: doctorPhotoUrl ?? '',
            },
            ...(localPhotoUri ? { attachments: [{ identifier: 'photo', url: localPhotoUri, type: 'image' }] } : {}),
          },
          trigger: null,
        }).catch(() => {})
      }
    })
    return () => sub.remove()
  }, [callStatus, consultationId, doctorName, doctorId, doctorPhotoUrl])

  // ── Token fetch — prefetched during ringing, not gated on Answer ──────────
  // Fetching only needs a Clerk token (no mic permission/consent), so start
  // it as soon as the channel is known — same as the doctor screen already
  // does — instead of waiting for the Answer tap. That keeps the Clerk-token
  // + Edge-Function round trip off the critical path between "tap Answer"
  // and "audio actually flows," which previously showed up as several
  // seconds of one-way silence right after answering.
  useEffect(() => {
    if (!channelName) return
    setTokenFetchFailed(false)
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(token => { setAgoraToken(token); setTokenFetchFailed(false) })
        .catch(err => { logger.error('[Phone][Patient] Token fetch failed:', err); setTokenFetchFailed(true) })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, localUid, tokenRetryKey])

  // ── Agora engine — join after token arrives ────────────────────────────────
  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID
    if (!appId || !channelName || !agoraToken || !readyToJoin || !muteLoaded) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try { engine = getAgoraEngine() } catch (e) {
      logger.error('[Phone][Patient] getAgoraEngine failed:', e)
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
      gracePeriodRef.current = setTimeout(() => {
        if (!mounted) return
        // Network issues must never end the consultation or force the patient
        // out of the call screen — only the doctor ending/declining/cancelling
        // may do that. Keep reconnecting indefinitely.
        logger.warn('[Phone][Patient] Grace period elapsed — still reconnecting, not leaving call')
        startGracePeriod()
      }, GRACE_PERIOD_MS)
    }

    const handler = {
      onJoinChannelSuccess: (connection: any) => {
        logger.log('[Phone][Patient] onJoinChannelSuccess channel:', connection?.channelId)
        // Re-apply the user's chosen mute state to the (possibly brand-new,
        // post-retry) engine — a fresh join always defaults to unmuted.
        try { engine?.muteLocalAudioStream(mutedRef.current) } catch {}
        // Our own join+publish succeeded (joinChannel publishes the mic track
        // directly for RTC engine calls) — report only our own milestone. The
        // DB trigger flips status/started_at once the doctor's own write
        // lands too; both clients learn of it from the same row update.
        state.markSelfConnected()
      },
      onUserJoined: (_conn: any, uid: number) => {
        logger.log('[Phone][Patient] onUserJoined uid:', uid)
        if (!mounted) return
        remoteUidRef.current = uid
        if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
        clearGracePeriod()
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
        setIsReconnecting(false)
        setRemoteConnected(true)
        setRemoteMuted(false)
        setLocalError(false)
      },
      onUserOffline: (_conn: any, uid: number, reason: number) => {
        logger.log('[Phone][Patient] onUserOffline uid:', uid, 'reason:', reason)
        if (!mounted || uid !== remoteUidRef.current) return
        // Debounce: 4s window so a mute event can cancel the offline transition
        if (userOfflineDebounceRef.current) clearTimeout(userOfflineDebounceRef.current)
        userOfflineDebounceRef.current = setTimeout(() => {
          userOfflineDebounceRef.current = null
          if (!mounted) return
          remoteUidRef.current = null
          setIsReconnecting(true)
          setRemoteConnected(false)
          startGracePeriod()
        }, MUTE_DEBOUNCE_MS)
      },
      onRemoteAudioStateChanged: (_conn: any, uid: number, _state: number, reason: number) => {
        if (!mounted) return
        // reason 5 = REMOTE_MUTED — cancel any pending offline debounce so mute isn't misread as disconnect
        if (reason === 5) {
          remoteMuteActiveRef.current = true
          setRemoteMuted(true)
          if (userOfflineDebounceRef.current) { clearTimeout(userOfflineDebounceRef.current); userOfflineDebounceRef.current = null }
        } else if (reason === 6) {
          remoteMuteActiveRef.current = false
          setRemoteMuted(false)
        }
      },
      onConnectionStateChanged: (_conn: any, state: number, reason: number) => {
        logger.log('[Phone][Patient] onConnectionStateChanged state:', state, 'reason:', reason)
        if (state === 5 && mounted) { proxyFallbackRef.current = true; setLocalError(true) }
        if (reason === 19 && mounted) Alert.alert('Session Ended', 'You joined from another device.')
      },
      onTokenPrivilegeWillExpire: () => {
        getToken().then(async tok => {
          if (!tok) return
          try {
            const refreshed = await fetchAgoraToken(channelName, localUid, tok)
            engine?.renewToken(refreshed)
          } catch {}
        })
      },
      onNetworkQuality: (_uid: any, txQuality: number) => {
        if (mounted) setNetworkQuality(txQuality as any)
      },
      onError: (err: any, msg: string) => {
        logger.error('[Phone][Patient] Agora error:', err, msg)
        proxyFallbackRef.current = true
        if (mounted) setLocalError(true)
      },
    }

    engine.registerEventHandler(handler)

    async function startCall() {
      try {
        const { status } = await Audio.requestPermissionsAsync()
        if (!mounted) return
        if (status !== 'granted') {
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
        engine!.disableVideo()
        // AudioProfileDefault (0) + AudioScenarioMeeting (8) — tuned for a
        // 1:1 voice-centric consultation (vs. the SDK's generic default).
        try { engine!.setAudioProfile(0, 8) } catch {}
        engine!.muteLocalAudioStream(mutedRef.current)
        engine!.setEnableSpeakerphone(speakerOn)
        if (proxyFallbackRef.current) engine!.setCloudProxy(3)
        logger.log(`[Phone][Patient] joinChannel → channel:${channelName} uid:${localUid} proxy:${proxyFallbackRef.current}`)
        const code = engine!.joinChannel(agoraToken, channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          autoSubscribeAudio: true,
        })
        if (typeof code === 'number' && code < 0) {
          logger.error('[Phone][Patient] joinChannel rejected:', code)
          proxyFallbackRef.current = true
          if (mounted) setLocalError(true)
          return
        }
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            proxyFallbackRef.current = true
            setLocalError(true)
          }
        }, 30000)
      } catch (e) {
        logger.error('[Phone][Patient] startCall error:', e)
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
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraToken, channelName, localUid, readyToJoin, muteLoaded])

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
        logger.error('[PhoneChat] watch failed:', err)
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

  const handleMissedCall = async () => {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    // Dismiss the OS call screen if still showing (e.g. auto-declined after countdown)
    if (consultationId) callkeep.endIncomingCall(consultationId)
    try {
      const token = await getToken()
      if (token && consultationId) {
        // DB trigger fires the doctor's missed-call notification off this
        // status change — no separate client-side notification call needed.
        await getAuthClient(token).from('consultations').update({ status: 'missed' }).eq('id', consultationId)
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
    // Carry pre-answer mute state into the call
    setMuted(preMuted)
    setRingPhase('answered')
    setReadyToJoin(true)
  }

  const handleEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    Alert.alert('Leave Call', 'You can rejoin at any time — the doctor will remain in the consultation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave Call', style: 'destructive',
        onPress: () => {
          // Best-effort, fire-and-forget — signals the doctor's screen to
          // show "Patient has left" instead of a generic "Reconnecting…".
          // Never touches `status`: the consultation stays in_progress.
          if (consultationId) {
            supabase
              .from('consultations')
              .update({ patient_left_at: new Date().toISOString() })
              .eq('id', consultationId)
              .eq('status', 'in_progress')
              .then(() => {}, () => {})
          }
          try { getAgoraEngine()?.leaveChannel() } catch {}
          releaseAgoraEngine()
          if (consultationId) callkeep.reportCallEnded(consultationId, 'remoteEnded')
          // Deliberately do NOT setActive(null) — the consultation is still
          // in_progress and the doctor remains in it. Leaving the
          // active-consultation store populated keeps ActiveCallBanner's
          // "Resume" pill (and the recovery effects in app/_layout.tsx)
          // pointed at this same consultation, so reopening the app or
          // tapping the ongoing-call notification takes the patient straight
          // back in.
          router.replace('/(patient)/(tabs)/appointments' as any)
        },
      },
    ])
  }

  const netLabel = networkQuality === 0 ? '' : networkQuality <= 2 ? 'Excellent' : networkQuality <= 4 ? 'Good' : 'Poor'
  const netColor = networkQuality <= 2 ? colors.success : networkQuality <= 4 ? colors.warning : colors.error
  const isConnected = callStatus === 'connected'
  const isConnecting = callStatus === 'connecting'

  // ── WAITING FOR DOCTOR SCREEN ───────────────────────────────────────────────
  if (callStatus === 'waiting_for_doctor') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.waitingDoctorScreen}>
          <View style={styles.waitingBadge}>
            <ActivityIndicator size="small" color={colors.tealGreen} />
            <Text style={styles.waitingBadgeText}>Waiting for Doctor</Text>
          </View>
          <View style={styles.waitingCenter}>
            <View style={styles.waitingAvatarWrap}>
              {doctorPhotoUrl
                ? <Image source={{ uri: doctorPhotoUrl }} style={styles.waitingPhoto} />
                : <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
              }
            </View>
            <Text style={styles.waitingDoctorName}>{formatDoctorName(doctorName)}</Text>
            {doctorSpecialty ? <Text style={styles.waitingSpecialty}>{doctorSpecialty}</Text> : null}
            <Text style={styles.waitingSubtitle}>The doctor will call you shortly…</Text>
            <Text style={styles.waitingHint}>Your call will start automatically when the doctor joins.</Text>
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

  // ── RINGING SCREEN ──────────────────────────────────────────────────────────
  if (callStatus === 'ringing') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.ringScreen}>
          <View style={styles.ringBadge}>
            <Ionicons name="call" size={14} color={colors.tealGreen} />
            <Text style={styles.ringBadgeText}>Incoming Phone Consultation</Text>
          </View>

          <View style={styles.ringCenter}>
            <Animated.View style={[styles.ringOuter, { transform: [{ scale: ringPulse }] }]}>
              <View style={styles.ringMid}>
                <View style={styles.ringInner}>
                  {doctorPhotoUrl
                    ? <Image source={{ uri: doctorPhotoUrl }} style={styles.ringPhoto} />
                    : <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
                  }
                </View>
              </View>
            </Animated.View>
            <Text style={styles.ringName}>{formatDoctorName(doctorName)}</Text>
            {doctorSpecialty ? <Text style={styles.ringSpecialty}>{doctorSpecialty}</Text> : null}
            <Text style={styles.ringSubtitle}>is calling you…</Text>
            <Text style={styles.ringCountdown}>Auto-declining in {ringCountdown}s</Text>

            {/* Optional pre-answer mute */}
            <Pressable
              style={({ pressed }) => [styles.preMuteBtn, preMuted && styles.preMuteBtnActive, pressed && { opacity: 0.75 }]}
              onPress={() => setPreMuted(m => !m)}
            >
              <Ionicons name={preMuted ? 'mic-off' : 'mic'} size={18} color={preMuted ? colors.warning : 'rgba(255,255,255,0.6)'} />
              <Text style={[styles.preMuteLabel, preMuted && styles.preMuteLabelActive]}>
                {preMuted ? 'Muted' : 'Mute before answering'}
              </Text>
            </Pressable>
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

  // ── ACTIVE CALL SCREEN ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
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

        <Text style={styles.timerLarge} numberOfLines={1} adjustsFontSizeToFit>
          {isConnected && startedAtIso
            ? formatCallDuration(seconds)
            : callStatus === 'reconnecting'
            ? 'Reconnecting…'
            : 'Connecting…'}
        </Text>

        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: callPulse }] }]}>
          {doctorPhotoUrl
            ? <Image source={{ uri: doctorPhotoUrl }} style={styles.avatarPhoto} />
            : <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
          }
        </Animated.View>

        <Text style={styles.callerName}>{formatDoctorName(doctorName)}</Text>
        {doctorSpecialty ? <Text style={styles.callerSub}>{doctorSpecialty}</Text> : null}

        {remoteMuted && isConnected && (
          <View style={styles.remoteMutedPill}>
            <Ionicons name="mic-off" size={12} color={colors.warning} />
            <Text style={styles.remoteMutedText}>Doctor is muted</Text>
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
        {callStatus === 'waiting' && (
          <View style={styles.infoStatusRow}>
            <ActivityIndicator size="small" color={colors.tealGreen} />
            <Text style={[styles.infoStatusText, { color: colors.tealGreen }]}>Waiting for doctor to join…</Text>
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
          onPress={toggleMute}
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
          accessibilityLabel="Leave call"
          hitSlop={8}
        >
          <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>

      {/* ── Info bottom sheet ── */}
      <CallInfoPanel
        visible={showInfoSheet}
        onClose={() => setShowInfoSheet(false)}
        consultationId={consultationId}
        consultationType="phone"
        counterpartLabel="Doctor"
        counterpartName={formatDoctorName(doctorName)}
        counterpartPhotoUrl={doctorPhotoUrl}
        startedAtIso={startedAtIso}
        elapsedSeconds={seconds}
        networkQuality={networkQuality}
      />

      {/* ── Chat bottom sheet ── */}
      <InCallChatPanel
        visible={chatOpen}
        onClose={closeChat}
        channel={activeChannel}
        channelLoading={channelLoading}
        userId={userId}
        consultationTypeIcon="call"
        readOnly={completion.showCompletedModal}
      />

      <ConsultationCompletedModal
        visible={completion.showCompletedModal}
        rawStatus={completion.rawStatus}
        onViewSummary={completion.goToSummary}
        onClose={completion.dismissModal}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080E22' },

  // ── Waiting for doctor screen ─────────────────────────────────────────────
  waitingDoctorScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, paddingHorizontal: 24,
  },
  waitingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,191,165,0.12)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(0,191,165,0.25)',
  },
  waitingBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },
  waitingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  waitingAvatarWrap: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(0,191,165,0.4)', overflow: 'hidden', marginBottom: 8,
  },
  waitingPhoto: { width: '100%', height: '100%' },
  waitingDoctorName: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite, textAlign: 'center' },
  waitingSpecialty: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
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

  // ── Ringing screen ──────────────────────────────────────────────────────────
  ringScreen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28 },
  ringBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,191,165,0.12)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(0,191,165,0.25)',
  },
  ringBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },
  ringCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
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
    borderWidth: 3, borderColor: colors.tealGreen, overflow: 'hidden',
  },
  ringPhoto: { width: '100%', height: '100%' },
  ringName: { fontFamily: fonts.bold, fontSize: 28, color: colors.mistWhite, textAlign: 'center' },
  ringSpecialty: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  ringSubtitle: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  ringCountdown: { fontFamily: fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 4 },
  preMuteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  preMuteBtnActive: {
    backgroundColor: 'rgba(255,193,7,0.12)',
    borderColor: 'rgba(255,193,7,0.3)',
  },
  preMuteLabel: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  preMuteLabelActive: { color: colors.warning },
  ringActions: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center',
    paddingBottom: 36,
  },

  // ── Active call screen ──────────────────────────────────────────────────────
  statusArea: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, gap: 8,
  },
  statusBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap', justifyContent: 'center' },

  timerLarge: {
    fontFamily: fonts.bold, fontSize: 40, color: colors.mistWhite,
    letterSpacing: 2, marginVertical: 4,
  },
  avatarWrap: {
    width: 124, height: 124, borderRadius: 62,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(0,191,165,0.45)',
    overflow: 'hidden',
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
  },
  avatarPhoto: { width: '100%', height: '100%' },
  callerName: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, textAlign: 'center' },
  callerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
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
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 10, paddingBottom: 2,
  },
  infoStatusText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  retryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 10, paddingBottom: 2,
  },
  retryText: { fontFamily: fonts.medium, fontSize: 13, color: colors.error },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingBottom: 32, paddingTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  endBtn: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#080E22',
  },
  unreadBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },
})
