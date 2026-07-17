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
  Platform,
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
import { submitConsultationCompletion } from '@/lib/consultationCompletion'
import { CallInfoPanel } from '@/components/consultation/CallInfoPanel'
import { InCallChatPanel } from '@/components/consultation/InCallChatPanel'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { streamClient, watchConsultationChannel } from '@/lib/stream'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { formatCallDuration } from '@/lib/callDuration'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'
import { logger } from '@/lib/logger'
import { localizeNotificationPhoto } from '@/lib/notificationPhoto'

const GRACE_PERIOD_MS = 90_000
const MUTE_DEBOUNCE_MS = 4_000

// Only used here to gate watchConsultationChannel() on availability — the
// actual chat UI now lives entirely in the shared InCallChatPanel.
let Chat: any = null
try {
  Chat = require('stream-chat-expo').Chat
} catch {}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'

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
  const { userId, isStreamConnected } = useAuthStore()
  const { getToken } = useAuth()
  const { setActive, updateElapsed, updateIdentity, updateCallStartedAt, setConnectionStatus } = useActiveConsultationStore()

  const [muted, setMuted] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [networkQuality, setNetworkQuality] = useState<0|1|2|3|4|5|6>(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  // True once this client has actually observed the patient's peer join the
  // audio channel — DB phase alone only proves each side's OWN join
  // succeeded, not that the two are actually connected to each other.
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [localError, setLocalError] = useState(false)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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
  // Cloud proxy (forced UDP relay) adds real latency/quality cost and should
  // only be paid on networks that actually need it — start without it, and
  // only fall back to it on the next join attempt if this one never
  // connects (join rejected, Agora error, or the 90s connect timeout fires).
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
  // publishes with the correct mute state — without this gate, a persisted
  // "muted" value that resolves after the join fires briefly lets the mic go
  // out live (unmuted) until the separate mute-sync effect catches up.
  const [muteLoaded, setMuteLoaded] = useState(false)
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
  // `remoteConnected` gates 'connected' too, not just phase — the DB-driven
  // phase only proves each side's OWN join succeeded (markSelfConnected),
  // not that this client has actually observed the patient's peer join the
  // audio channel.
  const callStatus: CallStatus = localError
    ? 'error'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? (remoteConnected ? 'connected' : 'connecting')
    : state.phase === 'waiting_for_patient'
    ? 'waiting'
    : 'connecting'

  // Also active during 'reconnecting' — the server-side stale-session cron
  // (mark_stale_active_consultations, migration 023) kills any in_progress
  // call whose heartbeat has gone quiet for 10 minutes. Pausing the
  // heartbeat the instant the patient drops (their disconnect flips this
  // client into 'reconnecting') means any patient network blip, backgrounded
  // app, or dead phone lasting past 10 minutes gets the whole consultation
  // silently ended_abnormally out from under the doctor, even though the
  // doctor never gave up. Matches the web doctor pages' equivalent fix.
  useHeartbeat(consultationId as string | undefined, callStatus === 'connected' || callStatus === 'reconnecting')

  const remoteUidRef = useRef<number | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gracePeriodCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userOfflineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callPulse = useRef(new Animated.Value(1)).current
  const ringPulse = useRef(new Animated.Value(1)).current
  const chatOpenRef = useRef(false)

  // Single source of truth for the "call ended" reaction — release Agora
  // resources exactly once, then navigate away. Doctor gets no completion
  // modal (a deliberate, preserved asymmetry vs. the patient side); the
  // rawStatus-branched Alert.alert copy stays screen-specific since it's UI
  // text, not detection/teardown logic.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'doctor',
    kind: 'phone',
    consultationId,
    onTeardown: () => {
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
    },
  })

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
      otherPersonPhotoUrl: patientPhotoUrl,
      role: 'doctor',
      elapsedSeconds: seconds,
      status: callStatus === 'reconnecting' ? 'reconnecting' : 'active',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  useEffect(() => { updateElapsed(seconds) }, [seconds, updateElapsed])

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
    setConnectionStatus(callStatus === 'reconnecting' ? 'reconnecting' : callStatus === 'connected' ? 'active' : 'connecting')
  }, [callStatus, setConnectionStatus])

  // ── Background notification (iOS only — Android gets the persistent,
  // real-timer Notifee notification from useOngoingConsultationNotification
  // instead, driven globally off the active-consultation store) ────────────
  useEffect(() => {
    if (Platform.OS === 'android') return
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      // Only fire when an active call is running — not during outgoing ringing (waiting)
      if (state === 'background' && (callStatus === 'connected' || callStatus === 'reconnecting')) {
        const localPhotoUri = await localizeNotificationPhoto(patientPhotoUrl)
        Notifications.scheduleNotificationAsync({
          content: {
            title: `Voice Consultation with ${displayName}`,
            body: `Tap to return to your voice consultation with ${displayName}`,
            sound: 'default',
            data: {
              screen: 'consultation',
              consultationId,
              consultationType: 'phone',
              patientName: displayName,
              patientId: patientUserId ?? '',
              patientPhotoUrl: patientPhotoUrl ?? '',
            },
            ...(localPhotoUri ? { attachments: [{ identifier: 'photo', url: localPhotoUri, type: 'image' }] } : {}),
          },
          trigger: null,
        }).catch(() => {})
      }
    })
    return () => sub.remove()
  }, [callStatus, consultationId, displayName, patientUserId, patientPhotoUrl])

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
    if (!appId || !channelName || !agoraToken || !muteLoaded) return

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
      gracePeriodRef.current = setTimeout(() => {
        if (!mounted) return
        // Network issues must never end the consultation — only an explicit
        // End Consultation / Decline / Cancel action may. Keep reconnecting
        // indefinitely; the doctor can still explicitly end the call.
        logger.warn('[Phone][Doctor] Grace period elapsed — still reconnecting, not ending call')
        startGracePeriod()
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
        setRemoteConnected(true)
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
          setRemoteConnected(false)
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
        proxyFallbackRef.current = true
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
        // AudioProfileDefault (0) + AudioScenarioMeeting (8) — tuned for a
        // 1:1 voice-centric consultation (vs. the SDK's generic default).
        try { engine!.setAudioProfile(0, 8) } catch {}
        engine!.muteLocalAudioStream(mutedRef.current)
        engine!.setEnableSpeakerphone(false)
        if (proxyFallbackRef.current) engine!.setCloudProxy(3)
        logger.log(`[Phone][Doctor] joinChannel → channel:${channelName} uid:${localUid} proxy:${proxyFallbackRef.current}`)
        const code = engine!.joinChannel(agoraToken, channelName, localUid, {
          clientRoleType: ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          autoSubscribeAudio: true,
        })
        if (typeof code === 'number' && code < 0) {
          logger.error('[Phone][Doctor] joinChannel rejected:', code)
          proxyFallbackRef.current = true
          if (mounted) setLocalError(true)
          return
        }
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && phaseRef.current !== 'on_call') {
            proxyFallbackRef.current = true
            setLocalError(true)
          }
        }, 90000)
      } catch (e) {
        logger.error('[Phone][Doctor] startCall error:', e)
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
  }, [agoraToken, channelName, localUid, muteLoaded])

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
        logger.error('[DoctorPhoneChat] watch failed:', err)
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
          logger.error('[DoctorPhone] completion failed at stage:', result.failedAt)
          setSubmitting(false)
          Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
          return
        }
      }
    } catch (err) {
      logger.error('[DoctorPhone] save summary failed:', err)
      setSubmitting(false)
      Alert.alert('Error', 'Could not save the consultation summary. Please try again.')
      return
    }
    setSubmitting(false)
    completion.markHandled()
    try { getAgoraEngine()?.leaveChannel(); releaseAgoraEngine() } catch {}
    clearPersistedMute(consultationId)
    setShowEndSheet(false)
    setActive(null)
    router.replace('/(doctor)/(tabs)/consultations' as any)
  }

  const handleEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    // Gate on the DB-derived phase, not `callStatus` — callStatus also folds
    // in this client's own local Agora error/connection-quality state
    // (`localError`, `remoteConnected`), which must never determine whether
    // the doctor can complete a consultation the server already recorded as
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

  const netLabel = networkQuality === 0 ? '' : networkQuality <= 2 ? 'Excellent' : networkQuality <= 4 ? 'Good' : 'Poor'
  const netColor = networkQuality <= 2 ? colors.success : networkQuality <= 4 ? colors.warning : colors.error
  const isConnected = callStatus === 'connected'
  const isConnecting = callStatus === 'connecting'
  // The patient tapped "Leave Call" (not a genuine network drop) — show a
  // calm, informational message instead of the urgent amber "Reconnecting…"
  // treatment. Cleared automatically once the patient rejoins (see
  // useConsultationState.clearPatientLeft, called on the patient's own
  // onJoinChannelSuccess).
  const patientHasLeft = callStatus === 'reconnecting' && !!state.patientHasLeft

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
              accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              hitSlop={8}
            >
              <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color={muted ? colors.mistWhite : 'rgba(255,255,255,0.85)'} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.82 }]}
              onPress={handleEnd}
              accessibilityLabel="Cancel call"
              hitSlop={8}
            >
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
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
          onClose={() => !submitting && setShowEndSheet(false)}
        />
      )}

      {/* ── Status area ── */}
      <View style={styles.statusArea}>
        <View style={styles.statusBadgeRow}>
          <StatusBadge
            icon={isConnected ? 'checkmark-circle' : patientHasLeft ? 'information-circle' : 'ellipsis-horizontal-circle'}
            label={isConnected ? 'Connected' : patientHasLeft ? 'Patient Left' : callStatus === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
            color={isConnected ? colors.success : patientHasLeft ? colors.tealGreen : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen}
          />
          <StatusBadge icon="shield-checkmark" label="Secure" color={colors.tealGreen} />
          {isConnected && networkQuality > 0 && (
            <StatusBadge icon="wifi" label={netLabel} color={netColor} />
          )}
        </View>

        <Text style={styles.timerLarge} numberOfLines={1} adjustsFontSizeToFit>
          {isConnected && startedAtIso
            ? formatCallDuration(seconds)
            : patientHasLeft
            ? 'Patient has left the consultation'
            : callStatus === 'reconnecting'
            ? 'Reconnecting…'
            : 'Connecting…'}
        </Text>

        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: callPulse }] }]}>
          {patientPhotoUrl ? (
            <Image source={{ uri: patientPhotoUrl }} style={styles.avatarWrapImage} />
          ) : (
            <Ionicons name="person" size={52} color="rgba(255,255,255,0.5)" />
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
              backgroundColor: isConnected ? colors.success : patientHasLeft ? colors.tealGreen : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen
            }]} />
            <Text style={[styles.infoValue, {
              color: isConnected ? colors.success : patientHasLeft ? colors.tealGreen : callStatus === 'reconnecting' ? colors.warning : colors.tealGreen
            }]}>
              {isConnected ? 'In progress' : patientHasLeft ? 'Patient has left the consultation' : callStatus === 'reconnecting' ? 'Reconnecting…' : callStatus === 'error' ? 'Connection Lost' : 'Connecting…'}
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
            {patientHasLeft ? (
              <Ionicons name="information-circle-outline" size={16} color={colors.tealGreen} />
            ) : (
              <ActivityIndicator size="small" color={colors.warning} />
            )}
            <Text style={[styles.infoStatusText, { color: patientHasLeft ? colors.tealGreen : colors.warning }]}>
              {patientHasLeft ? 'Patient has left the consultation' : 'Reconnecting…'}
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
          accessibilityLabel="End call"
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
        counterpartLabel="Patient"
        counterpartName={displayName}
        counterpartPhotoUrl={patientPhotoUrl}
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
      />
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
    fontFamily: fonts.bold, fontSize: 40, color: colors.mistWhite,
    letterSpacing: 2, marginVertical: 4,
  },
  avatarWrap: {
    width: 124, height: 124, borderRadius: 62,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(0,191,165,0.45)',
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
    overflow: 'hidden',
  },
  avatarWrapImage: { width: '100%', height: '100%', borderRadius: 62 },
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
