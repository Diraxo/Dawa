'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'
import { uidFromString, fetchAgoraToken, trackAgoraLeave, waitForPendingAgoraLeave, classifyMediaError } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { getPersistedCameraOff, setPersistedCameraOff } from '@/lib/callCameraStorage'
import { stripDrPrefix } from '@/lib/utils'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { formatCallDuration } from '@/lib/callDuration'
import { ConsultationInfoPanel } from '@/components/consultation/ConsultationInfoPanel'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'
import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { DraggableSelfView } from '@/components/consultation/DraggableSelfView'
import { SpeakingPulse } from '@/components/consultation/SpeakingPulse'
import { ConsultationCompletedModal } from '@/components/consultation/ConsultationCompletedModal'
import { MessageCircle, Info, Video, CameraOff } from 'lucide-react'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, ICameraVideoTrack } from 'agora-rtc-sdk-ng'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  doctor: {
    specialty: string
    user: { full_name: string; clerk_id: string; profile_photo_url: string | null } | null
  } | null
}

type CallStatus = 'ringing' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error' | 'ended'

const STATUS_LABEL: Record<CallStatus, string> = {
  ringing: 'Incoming call…',
  connecting: 'Connecting…',
  waiting: 'Waiting for doctor…',
  connected: 'On Call',
  reconnecting: 'Reconnecting…',
  error: 'Connection Lost',
  ended: 'Call ended',
}

export default function VideoConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(() => getPersistedMute(id))
  // Bare useState(false) previously meant "camera off" silently reset to
  // "on" on every refresh/reconnect — mirror the mute-persistence pattern.
  const [camOff, setCamOff] = useState(() => getPersistedCameraOff(id))
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  const [isReconnecting, setIsReconnecting] = useState(false)
  // True once this client has actually observed the doctor's peer publish
  // media — the DB phase alone only proves each side's OWN join succeeded,
  // not that the two are actually connected to each other.
  const [remotePeerPresent, setRemotePeerPresent] = useState(false)
  const [, setReconnectCountdown] = useState(90)
  const [ringCountdown, setRingCountdown] = useState(60)
  // Dismissed the instant we start (or resume) joining Agora — either the
  // user tapped Answer, or the call was already accepted/in_progress on
  // mount. Once dismissed it never re-shows; the ringing screen is purely
  // pre-join local UI, not part of the DB-derived call phase.
  const [ringingDismissed, setRingingDismissed] = useState(false)
  const [networkQuality, setNetworkQuality] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [remoteCamOff, setRemoteCamOff] = useState(false)
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  // Driven by Agora's volume-indicator event — who's currently talking, for
  // the speaking-indicator pulse (self view for the patient, the doctor's
  // avatar/video area for the doctor).
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const [remoteSpeaking, setRemoteSpeaking] = useState(false)

  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
  const camTrackRef = useRef<ICameraVideoTrack | null>(null)
  const remoteVideoRef = useRef<HTMLDivElement>(null)
  const localVideoRef = useRef<HTMLDivElement>(null)
  const agoraStartedRef = useRef(false)
  const endedAtMountRef = useRef(false)
  // Keeps the always-current mute intent so it can be re-applied the instant
  // a new mic track is created (retry/reconnect), without waiting on React state.
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  const toggleMute = () => {
    setMuted(m => {
      const next = !m
      setPersistedMute(id, next)
      return next
    })
  }
  // Keeps the always-current camera intent so it can be re-applied the
  // instant a new cam track is created (retry/reconnect), mirroring mutedRef.
  const camOffRef = useRef(camOff)
  useEffect(() => { camOffRef.current = camOff }, [camOff])
  const toggleCamera = () => {
    setCamOff(c => {
      const next = !c
      setPersistedCameraOff(id, next)
      return next
    })
  }
  // Decoupled from ringingDismissed so a DB-confirmed 'connected' display on
  // mount doesn't get clobbered back to 'connecting' — Agora join still needs
  // to fire in the background regardless of what's currently displayed.
  const [readyToJoin, setReadyToJoin] = useState(false)

  // Single source of truth for call phase/timer — derived from the DB row via
  // Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: id as string, role: 'patient', localAgoraReconnecting: isReconnecting })

  // A reload/resume mid-call (or mid-waiting) means the call already
  // progressed past the ringing screen on some earlier visit/device.
  useEffect(() => {
    if (state.phase === 'on_call' || state.phase === 'reconnecting' || state.phase === 'waiting_for_doctor') {
      setRingingDismissed(true)
    }
  }, [state.phase])

  // `remotePeerPresent` gates 'connected' too, not just phase — the DB-driven
  // phase only proves each side's OWN join succeeded, not that this client
  // has actually received the doctor's media (see user-published handler).
  const displayStatus: CallStatus = !ringingDismissed
    ? 'ringing'
    : errorMessage
    ? 'error'
    : state.phase === 'ended'
    ? 'ended'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? (remotePeerPresent ? 'connected' : 'connecting')
    : state.phase === 'waiting_for_doctor'
    ? 'waiting'
    : 'connecting'

  // Single source of truth for the "call ended" reaction — release Agora
  // resources exactly once, then surface the completion dialog, whether the
  // doctor ended the call or it completed/ended abnormally on some other
  // device/session.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'patient',
    kind: 'video',
    consultationId: id as string,
    onTeardown: () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
      cleanupAgora()
    },
  })

  // Also active during 'reconnecting' — see doctor video page for why: the
  // server-side stale-session cron kills any in_progress call whose
  // heartbeat has gone quiet for 10 minutes, and pausing it during a
  // network blip risks the cron ending a call the patient is still trying
  // to reconnect to.
  useHeartbeat(id as string, displayStatus === 'connected' || displayStatus === 'reconnecting')

  // Warn before tab close during an active call
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (displayStatus === 'connected' || displayStatus === 'waiting') {
        e.preventDefault()
        e.returnValue = 'You have an ongoing consultation. Are you sure you want to leave?'
      }
    }
    window.addEventListener('beforeunload', handle)
    return () => window.removeEventListener('beforeunload', handle)
  }, [displayStatus])

  async function handleMissedCall() {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    try {
      const clerkToken = await getToken()
      if (clerkToken && id) {
        // DB trigger fires the doctor's missed-call notification off this
        // status change — no separate client-side notification call needed.
        await getAuthClient(clerkToken)
          .from('consultations')
          .update({ status: 'missed' })
          .eq('id', id as string)
      }
    } catch {}
    router.replace('/patient')
  }

  // Ring countdown: auto-decline after 60s
  useEffect(() => {
    if (ringingDismissed) {
      if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
      return
    }
    setRingCountdown(60)
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
    return () => { if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringingDismissed])

  // Load consultation display data and bail out of the Agora join entirely if
  // the consultation was already terminal on mount. Call phase/timer/waiting
  // state themselves come from useConsultationState, not from here.
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, status, started_at, doctor:doctor_profiles(specialty, user:users(full_name, clerk_id, profile_photo_url))')
        .eq('id', id)
        .single()
      setConsultation(data as unknown as Consultation)
      setLoading(false)
      const status = (data as unknown as { status: string })?.status
      if (status === 'accepted' || status === 'in_progress') {
        setReadyToJoin(true)
      }
      if (status === 'completed' || status === 'ended_abnormally') {
        endedAtMountRef.current = true
      }
    }
    load()
  }, [id])

  // Auto-join when consultation already accepted/in_progress on page load.
  // Decoupled from ringingDismissed so a DB-confirmed 'connected' display
  // never blocks the Agora join that needs to happen in the background.
  useEffect(() => {
    if (readyToJoin && user && !agoraStartedRef.current) {
      joinAgora()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToJoin, user])

  // Second, more robust path into readyToJoin: the one-shot mount `load()`
  // fetch above can race the doctor's accept (or simply fail/lag), leaving
  // readyToJoin false and the patient stuck on the "ringing" screen with its
  // 60s auto-decline counting down even though the call was already
  // accepted. useConsultationState's rawStatus is continuously kept current
  // via Realtime + a 3s poll, so this closes that race regardless of why the
  // mount fetch missed it.
  useEffect(() => {
    if (!readyToJoin && (state.rawStatus === 'accepted' || state.rawStatus === 'in_progress')) {
      setReadyToJoin(true)
    }
  }, [state.rawStatus, readyToJoin])

  // Leave the Agora channel on unmount so a stale UID doesn't collide with a future rejoin
  useEffect(() => {
    return () => { cleanupAgora() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync mute
  useEffect(() => {
    micTrackRef.current?.setEnabled(!muted)
  }, [muted])

  // Sync camera
  useEffect(() => {
    camTrackRef.current?.setEnabled(!camOff)
  }, [camOff])

  async function cleanupAgora() {
    if (micTrackRef.current) { micTrackRef.current.close(); micTrackRef.current = null }
    if (camTrackRef.current) { camTrackRef.current.close(); camTrackRef.current = null }
    if (agoraClientRef.current) {
      const client = agoraClientRef.current
      agoraClientRef.current = null
      // Track this leave so a subsequent join for the same channel (remount,
      // retry, etc.) waits for it to fully complete instead of racing it —
      // an overlapping join+leave on the same UID is what causes UID_CONFLICT.
      const leaving = client.leave().catch(() => {})
      trackAgoraLeave(id as string, leaving)
      await leaving
    }
  }

  async function joinAgora() {
    if (agoraStartedRef.current || endedAtMountRef.current) return
    agoraStartedRef.current = true
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
    if (!appId || !id || !user) { setErrorMessage('Unable to connect. Please check your network and try again.'); return }
    const appIdStr = appId as string
    const channelId = id as string
    const maskedAppId = appIdStr.length > 8
      ? `${appIdStr.slice(0, 4)}…${appIdStr.slice(-4)}`
      : '(short-id)'
    // Joining (whether user-initiated via Answer, or auto-triggered because
    // the call was already accepted/in_progress on mount) always dismisses
    // the ringing screen — call phase itself now comes from the DB row.
    setRingingDismissed(true)
    try {
      // ── (1) Consultation ID  (2) Role  (3) App ID  ──────────────────────
      logger.log(`[Video][Patient][${Date.now()}] === AGORA JOIN START ===`)
      logger.log(`[Video][Patient][${Date.now()}] consultationId:${channelId} | role:patient | type:video`)
      logger.log(`[Video][Patient][${Date.now()}] appId (masked):${maskedAppId} appIdLen:${appIdStr.length}`)

      // Pre-request mic+camera permission so the browser dialog is surfaced early
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        stream.getTracks().forEach(t => t.stop())
      } catch (permErr) {
        const { name, genuinelyDenied } = classifyMediaError(permErr)
        logger.error(`[Video][Patient][${Date.now()}] getUserMedia failed (${name}) — genuinelyDenied:${genuinelyDenied}`)
        setErrorMessage(
          genuinelyDenied
            ? 'Camera/microphone access denied.\n\n' +
              'To fix: click the 🔒 icon in your browser address bar → ' +
              'Site settings → Camera & Microphone → Allow → then click Retry.'
            : 'Unable to access your camera/microphone.\n\n' +
              'Another app or browser tab may be using it — close it, then tap Retry.'
        )
        return
      }
      const clerkToken = await getToken()
      if (!clerkToken) { setErrorMessage('Unable to connect. Please check your network and try again.'); return }

      // ── (4) Channel  (5) UID ─────────────────────────────────────────────
      const uid = uidFromString(user.id)
      logger.log(`[Video][Patient][${Date.now()}] channel:${channelId} | uid:${uid}`)

      // ── (6-8) Token ───────────────────────────────────────────────────────
      logger.log(`[Video][Patient][${Date.now()}] Fetching Agora token…`)
      const { token: agoraToken, expiresAt } = await fetchAgoraToken(channelId, uid, clerkToken)
      const tokenExpiresIso = new Date(expiresAt * 1000).toISOString()
      logger.log(`[Video][Patient][${Date.now()}] token exists:${!!agoraToken} len:${agoraToken?.length ?? 0} expires:${tokenExpiresIso}`)

      logger.log(`[Video][Patient][${Date.now()}] importing agora-rtc-sdk-ng`)
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng')
      logger.log(`[Video][Patient][${Date.now()}] createClient — mode:rtc codec:vp8`)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      agoraClientRef.current = client

      // Tracks whether we're mid-reconnect so a spurious user-unpublished
      // firing purely from the network blip (not a real mute/camera-off) is
      // ignored — reconnecting must never be interpreted as a real mute.
      let isReconnectingLocal = false

      // Shared "show reconnecting" logic, used for both a remote disconnect
      // (doctor's side drops) and a local network drop (our own
      // connection-state-change) so the two paths can't diverge. Network
      // issues must never end the consultation or block the UI with a
      // Retry/Leave dialog — the Agora SDK keeps retrying the same session
      // internally, so this just keeps reflecting "Reconnecting…" for as
      // long as it takes, the same as the native app.
      function enterReconnecting() {
        isReconnectingLocal = true
        setRemoteMuted(false)
        setRemoteCamOff(false)
        setRemotePeerPresent(false)
        setIsReconnecting(true)
        startReconnectLoop()
      }
      function startReconnectLoop() {
        setReconnectCountdown(90)
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
        if (reconnectCountdownRef.current) clearInterval(reconnectCountdownRef.current)
        reconnectTimerRef.current = setTimeout(() => {
          if (!agoraStartedRef.current) return
          logger.warn(`[Video][Patient][${Date.now()}] 90s reconnect window elapsed — still reconnecting, not ending call`)
          startReconnectLoop()
        }, 90000)
        reconnectCountdownRef.current = setInterval(() => {
          setReconnectCountdown(c => { if (c <= 1) { clearInterval(reconnectCountdownRef.current!); return 0 } return c - 1 })
        }, 1000)
      }
      function exitReconnecting() {
        isReconnectingLocal = false
        setIsReconnecting(false)
        // Whatever mute/camera state we inferred while the connection was
        // flaky is not trustworthy — a fresh publish event (if the remote is
        // truly still muted/camera-off) will set it again.
        setRemoteMuted(false)
        setRemoteCamOff(false)
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
        if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
        // A user-published event that raced the disconnect (peerConnection
        // already down when we tried to subscribe) is dropped rather than
        // retried inline — sweep for any published-but-unsubscribed remote
        // media now that the peerConnection is back up.
        resubscribeAll()
      }

      async function resubscribeAll() {
        for (const remoteUser of client.remoteUsers) {
          if (remoteUser.hasAudio && !remoteUser.audioTrack) {
            try {
              await client.subscribe(remoteUser, 'audio')
              // Cast breaks stale TS control-flow narrowing carried over from
              // the `!remoteUser.audioTrack` guard above — subscribe()
              // populates this at runtime but TS can't see that.
              const audioTrack = (remoteUser as any).audioTrack
              audioTrack?.play()
              logger.log(`[Video][Patient][${Date.now()}] resubscribed audio uid:${remoteUser.uid}`)
            } catch (e) {
              logger.error(`[Video][Patient][${Date.now()}] resubscribe audio failed uid:${remoteUser.uid}:`, e)
            }
          }
          if (remoteUser.hasVideo && !remoteUser.videoTrack) {
            try {
              await client.subscribe(remoteUser, 'video')
              const videoTrack = (remoteUser as any).videoTrack
              if (remoteVideoRef.current) videoTrack?.play(remoteVideoRef.current, { fit: 'contain' })
              logger.log(`[Video][Patient][${Date.now()}] resubscribed video uid:${remoteUser.uid}`)
            } catch (e) {
              logger.error(`[Video][Patient][${Date.now()}] resubscribe video failed uid:${remoteUser.uid}:`, e)
            }
          }
        }
        // The doctor is still in client.remoteUsers even if nothing needed
        // resubscribing (e.g. only OUR connection blipped, their tracks never
        // unsubscribed) — either way, their presence here means media is
        // flowing again, so the timer/LIVE badge can resume.
        if (client.remoteUsers.length > 0) setRemotePeerPresent(true)
      }

      // ── (21) Connection-state changes ────────────────────────────────────
      client.on('connection-state-change', (curState, prevState, reason) => {
        logger.log(`[Video][Patient][${Date.now()}] connectionStateChange ${prevState}→${curState} reason:${reason}`)
        // Local network drop: the SDK auto-retries the SAME session internally —
        // we only need to reflect it in the UI, never call join()/leave() ourselves here.
        if ((curState === 'RECONNECTING' || curState === 'DISCONNECTED') && prevState === 'CONNECTED') {
          logger.error(`[Video][Patient][${Date.now()}] Local connection lost reason:${reason} — reconnecting`)
          enterReconnecting()
        } else if (curState === 'CONNECTED' && (prevState === 'RECONNECTING' || prevState === 'DISCONNECTED')) {
          logger.log(`[Video][Patient][${Date.now()}] Local connection restored`)
          exitReconnecting()
        }
      })

      // ── (22) SDK exceptions (non-fatal errors) ───────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on('exception', (event: any) => {
        logger.error(`[Video][Patient][${Date.now()}] SDK exception code:${event?.code} msg:${event?.msg}`)
      })

      client.on('token-privilege-will-expire', async () => {
        logger.log(`[Video][Patient][${Date.now()}] Token privilege will expire — renewing`)
        try {
          const tok = await getToken()
          if (!tok) return
          const { token: newToken } = await fetchAgoraToken(channelId, uid, tok)
          await client.renewToken(newToken)
          logger.log(`[Video][Patient][${Date.now()}] Token renewed`)
        } catch (e) { logger.error(`[Video][Patient][${Date.now()}] Token renewal failed:`, e) }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on('network-quality', (stats: any) => {
        setNetworkQuality(stats.uplinkNetworkQuality ?? 0)
      })

      // Speaking-indicator pulse — reports both the local user's own volume
      // and the doctor's, distinguished by uid.
      client.enableAudioVolumeIndicator()
      client.on('volume-indicator', volumes => {
        let local = false
        let remote = false
        for (const v of volumes) {
          const speaking = v.level > 50
          if (v.uid === uid) local = local || speaking
          else remote = remote || speaking
        }
        setLocalSpeaking(local)
        setRemoteSpeaking(remote)
      })

      // ── (18) user-joined ─────────────────────────────────────────────────
      client.on('user-joined', (remoteUser) => {
        logger.log(`[Video][Patient][${Date.now()}] user-joined uid:${remoteUser.uid}`)
      })

      // ── (19) user-published ──────────────────────────────────────────────
      client.on('user-published', async (remoteUser, mediaType) => {
        logger.log(`[Video][Patient][${Date.now()}] user-published uid:${remoteUser.uid} type:${mediaType}`)
        try {
          await client.subscribe(remoteUser, mediaType)
        } catch (e) {
          // Can race a local connection drop (peerConnection already
          // disconnected when this fires) — exitReconnecting()'s sweep picks
          // it up once the connection is restored. Must not throw out of an
          // event handler: an unhandled rejection here crashes the call screen.
          logger.error(`[Video][Patient][${Date.now()}] subscribe failed uid:${remoteUser.uid} type:${mediaType}:`, e)
          return
        }
        logger.log(`[Video][Patient][${Date.now()}] subscribed uid:${remoteUser.uid} type:${mediaType}`)

        // Call phase/timer come from the DB row (see useConsultationState),
        // but that only proves each side's OWN join succeeded — not that
        // this client has actually received the doctor's media. Gate
        // `displayStatus === 'connected'` on this too so the timer/LIVE
        // badge never runs while the video area is still a black/placeholder
        // screen (item 4).
        setRemotePeerPresent(true)
        if (mediaType === 'video') {
          if (remoteVideoRef.current) remoteUser.videoTrack?.play(remoteVideoRef.current, { fit: 'contain' })
          setRemoteCamOff(false)
        }
        if (mediaType === 'audio') {
          if (!remoteUser.audioTrack) {
            logger.error(`[Video][Patient][${Date.now()}] user-published audio but remoteUser.audioTrack is missing after subscribe — nothing to play`)
          } else {
            remoteUser.audioTrack.play()
            logger.log(`[Video][Patient][${Date.now()}] playing remote audio — track exists`)
          }
          setRemoteMuted(false)
        }

        setIsReconnecting(false)
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
        if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
      })

      client.on('user-unpublished', (remoteUser, mediaType) => {
        logger.log(`[Video][Patient][${Date.now()}] user-unpublished uid:${remoteUser.uid} type:${mediaType}`)
        // Ignore while mid-reconnect: a network blip can force an unpublish
        // that has nothing to do with a real mute/camera-off.
        if (isReconnectingLocal) return
        if (mediaType === 'audio') setRemoteMuted(true)
        if (mediaType === 'video') setRemoteCamOff(true)
      })

      // ── (20) user-left ───────────────────────────────────────────────────
      client.on('user-left', (remoteUser, reason) => {
        logger.log(`[Video][Patient][${Date.now()}] user-left uid:${remoteUser.uid} reason:${reason}`)
        // enterReconnecting() clears remotePeerPresent too — doctor may
        // reconnect within the grace period, at which point a fresh
        // user-published sets it again.
        enterReconnecting()
      })

      // ── (9) Join ─────────────────────────────────────────────────────────
      const _diagNow = Math.floor(Date.now() / 1000)
      logger.log(`[Video][Patient] [PRE-JOIN] Token length:${agoraToken?.length ?? 0}`)
      logger.log(`[Video][Patient] [PRE-JOIN] Token expiresAt:${new Date(expiresAt * 1000).toISOString()}`)
      logger.log(`[Video][Patient] [PRE-JOIN] Current browser time:${new Date(_diagNow * 1000).toISOString()}`)
      logger.log(`[Video][Patient] [PRE-JOIN] Seconds until expiration:${expiresAt - _diagNow}`)
      logger.log(`[Video][Patient] [PRE-JOIN] Channel:${channelId}`)
      logger.log(`[Video][Patient] [PRE-JOIN] UID:${uid}`)
      logger.log(`[Video][Patient][${Date.now()}] client.join → channel:${channelId} uid:${uid}`)
      // Never join while a previous session's leave() for this channel is still
      // in flight — joining with the same UID before that completes is what
      // triggers UID_CONFLICT.
      await waitForPendingAgoraLeave(channelId)
      if (endedAtMountRef.current) return
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Join timeout — check network or Agora credentials')), 30000)
        client.join(appIdStr, channelId, agoraToken, uid).then(() => { clearTimeout(t); resolve() }).catch(err => { clearTimeout(t); reject(err) })
      })
      logger.log(`[Video][Patient][${Date.now()}] client.join — succeeded`)

      // ── (14-15) Local tracks ─────────────────────────────────────────────
      logger.log(`[Video][Patient][${Date.now()}] createMicrophoneAndCameraTracks — requesting`)
      const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks(
        { AEC: true, AGC: true, ANS: true, encoderConfig: 'speech_standard' },
        { encoderConfig: { width: 960, height: 540, frameRate: 24, bitrateMin: 600, bitrateMax: 1200 } }
      )
      logger.log(`[Video][Patient][${Date.now()}] createMicrophoneAndCameraTracks — mic and cam tracks ready. mic.enabled:${mic.enabled} mic.muted:${mic.muted} cam.enabled:${cam.enabled}`)
      micTrackRef.current = mic
      camTrackRef.current = cam
      // Re-apply the user's chosen mute/camera state to this (possibly
      // brand-new, post-retry) track — a fresh track always defaults to
      // enabled.
      mic.setEnabled(!mutedRef.current)
      cam.setEnabled(!camOffRef.current)
      if (localVideoRef.current) cam.play(localVideoRef.current, { fit: 'contain' })

      // ── (16-17) Publish ──────────────────────────────────────────────────
      logger.log(`[Video][Patient][${Date.now()}] client.publish — publishing mic+cam`)
      await client.publish([mic, cam])
      logger.log(`[Video][Patient][${Date.now()}] client.publish — done. localTracks published:${client.localTracks.map(t => t.trackMediaType).join(',')} mic.enabled:${mic.enabled} — waiting for doctor`)
      // Our own join+publish succeeded — report only our own milestone. The
      // DB trigger flips status/started_at once the doctor's own write lands
      // too; both clients learn of it from the same row update.
      state.markSelfConnected()
      // Clear any stale patient_left_at from a previous Leave Call — this is
      // a genuine (re)join, so the doctor's "Patient has left" banner (if
      // showing) should drop immediately.
      state.clearPatientLeft()
    } catch (err) {
      logger.error(`[Video][Patient][${Date.now()}] Fatal join error:`, err)
      const msg = err instanceof Error && err.message.includes('timeout')
        ? 'Connection timed out. Please check your network and try again.'
        : 'Unable to connect. Please check your network and try again.'
      setErrorMessage(msg)
    }
  }

  function handleAnswer() {
    joinAgora()
  }

  // Explicit decline click — distinct from a silent ring timeout
  // (handleMissedCall above): recorded as 'call_declined' so doctor-side
  // copy and admin records accurately show "the patient declined".
  async function handleDecline() {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    try {
      const clerkToken = await getToken()
      if (clerkToken && id) {
        // DB trigger fires the doctor's call_declined notification off this
        // status change — no separate client-side notification call needed.
        await getAuthClient(clerkToken)
          .from('consultations')
          .update({ status: 'call_declined' })
          .eq('id', id as string)
      }
    } catch {}
    router.replace('/patient')
  }

  async function leaveCall() {
    const isActive = displayStatus === 'connected' || displayStatus === 'waiting'
    if (isActive && !window.confirm('Leave call? You can rejoin — the doctor will remain in the consultation.')) return
    try {
      const tok = await getToken()
      if (tok) {
        await getAuthClient(tok)
          .from('consultations')
          .update({ patient_left_at: new Date().toISOString() })
          .eq('id', id as string)
          .eq('status', 'in_progress')
      }
    } catch {}
    await cleanupAgora()
    router.push('/patient')
  }

  function openChat() {
    setChatOpen(true)
    setChatUnreadCount(0)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-white/40 text-sm">Connecting video…</div>
      </div>
    )
  }

  const doctorName = stripDrPrefix(consultation?.doctor?.user?.full_name ?? 'Doctor')
  const doctorPhotoUrl = consultation?.doctor?.user?.profile_photo_url ?? null
  const elapsed = state.elapsedSeconds ?? 0

  // ── Ringing screen ──────────────────────────────────────────────────────────
  if (displayStatus === 'ringing') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-8 px-6">
        <p className="text-xs uppercase tracking-widest font-bold text-white/50">Incoming Video Call</p>

        {/* Pulsing rings */}
        <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
          <div className="absolute w-[200px] h-[200px] rounded-full border-2 border-purple-500/30 animate-ping" />
          <div className="absolute w-[165px] h-[165px] rounded-full border-2 border-purple-500/50 animate-ping" style={{ animationDelay: '0.3s' }} />
          <div className="w-[130px] h-[130px] rounded-full bg-gradient-to-br from-purple-600 to-care-blue flex items-center justify-center text-white font-black text-5xl shadow-2xl overflow-hidden">
            {doctorPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doctorPhotoUrl} alt={doctorName} className="w-full h-full object-cover" />
            ) : (
              doctorName.charAt(0)
            )}
          </div>
        </div>

        <div className="text-center">
          <h1 className="font-montserrat font-black text-2xl text-white mb-1">Dr. {doctorName}</h1>
          <p className="text-white/50 text-sm">{consultation?.doctor?.specialty}</p>
          <p className="text-purple-400 font-semibold text-sm mt-1 flex items-center justify-center gap-1.5"><Video className="w-4 h-4" /> Video Consultation</p>
        <p className="text-white/30 text-xs mt-1">Auto-declining in {ringCountdown}s</p>
        </div>

        <ConsultationActionButtons
          onDecline={handleDecline}
          onAccept={handleAnswer}
          declineLabel="Decline"
          acceptLabel="Answer"
          size={64}
        />
      </div>
    )
  }

  // ── Ended screen ────────────────────────────────────────────────────────────
  // The consultation is over the instant this renders (Agora already torn
  // down by the cleanup effect above) — the completion dialog is the only UI,
  // matching the shared modal used by chat/phone/video across mobile+web.
  if (displayStatus === 'ended') {
    return (
      <div className="min-h-screen bg-[#0A0A0A]">
        <ConsultationCompletedModal
          open
          onViewSummary={completion.goToSummary}
          onClose={completion.dismissModal}
        />
      </div>
    )
  }

  // ── Active call screen ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex">
      {/* Main video area */}
      <div className={`flex flex-col relative overflow-hidden transition-all duration-300 ${chatOpen ? 'flex-1' : 'w-full'}`}>
        {/* Remote video — doctor (full screen) */}
        <div className="flex-1 relative bg-[#111827]">
          <div ref={remoteVideoRef} className="absolute inset-0" />

          {/* Avatar placeholder — shown any time live video isn't actually
              flowing (not connected yet, reconnecting, or camera off), so
              the doctor's photo + name replaces a frozen frame or black
              screen immediately, with no delay. */}
          {(displayStatus !== 'connected' || remoteCamOff) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#111827]">
              <div className="text-center">
                <SpeakingPulse active={remoteSpeaking && displayStatus === 'connected'} className="w-40 h-40 rounded-full mx-auto mb-4">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white font-black text-6xl shadow-lg overflow-hidden">
                    {doctorPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={doctorPhotoUrl} alt={doctorName} className="w-full h-full object-cover" />
                    ) : (
                      doctorName.charAt(0)
                    )}
                  </div>
                </SpeakingPulse>
                <p className="text-white/60 text-sm">Dr. {doctorName}</p>
                {displayStatus === 'error' ? (
                  <div className="mt-2 flex flex-col items-center gap-3 max-w-xs text-center">
                    <p className="text-danger/80 text-xs whitespace-pre-line">
                      {errorMessage || 'Connection failed. Check your camera/microphone permissions.'}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          await cleanupAgora()
                          agoraStartedRef.current = false
                          setErrorMessage('')
                          joinAgora()
                        }}
                        className="text-white text-xs border border-white/30 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        onClick={leaveCall}
                        className="text-white/70 text-xs border border-white/20 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                      >
                        Leave Consultation
                      </button>
                    </div>
                  </div>
                ) : displayStatus === 'connected' ? null : (
                  <p className="text-white/40 text-xs mt-1">
                    {STATUS_LABEL[displayStatus]}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Doctor muted badge */}
          {displayStatus === 'connected' && remoteMuted && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 rounded-full px-3 py-1.5 pointer-events-none z-10">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span className="text-white/80 text-xs">Doctor is muted</span>
            </div>
          )}

          {/* Timer + Network — only once actually connected; never show
              00:00 while still connecting/waiting/reconnecting */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
            {displayStatus === 'connected' && (
              <div className="bg-black/50 rounded-full px-3 py-1.5 flex items-end gap-0.5" style={{ height: 28 }}>
                {[1, 2, 3].map(b => {
                  const bars = networkQuality === 0 ? 3 : networkQuality <= 2 ? 3 : networkQuality <= 4 ? 2 : 1
                  const color = networkQuality <= 2 ? '#4ADE80' : networkQuality <= 4 ? '#FBBF24' : '#F87171'
                  return <div key={b} style={{ width: 3, height: 4 + b * 4, borderRadius: 1.5, backgroundColor: b <= bars ? color : 'rgba(255,255,255,0.2)', alignSelf: 'flex-end' }} />
                })}
              </div>
            )}
            <div className="bg-black/50 rounded-full px-4 py-1.5">
              <span className="text-white font-mono text-sm">
                {displayStatus === 'connected' ? formatCallDuration(elapsed) : displayStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
              </span>
            </div>
          </div>

          {/* Reconnect banner */}
          {isReconnecting && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 bg-black/70 border border-yellow-400/40 rounded-2xl px-6 py-3 z-20 min-w-[260px]">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin" />
                <span className="text-yellow-300 text-sm font-semibold">Reconnecting…</span>
              </div>
              <p className="text-yellow-300/60 text-xs">Attempting to restore connection…</p>
            </div>
          )}

          {/* Local camera — draggable, WhatsApp-style floating PiP, starts bottom-right */}
          <DraggableSelfView bottom={16} isOff={false} isSpeaking={localSpeaking}>
            <div ref={localVideoRef} className="absolute inset-0" />
            {camOff && (
              <div className="absolute inset-0 flex items-center justify-center text-white/40 bg-[#1F2937]">
                <CameraOff className="w-6 h-6" />
              </div>
            )}
          </DraggableSelfView>
        </div>

        {/* Controls bar */}
        <div className="bg-black/85 px-6 py-5 flex items-center justify-center gap-6">
          {/* Mute */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
              {muted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          </div>

          {/* Camera */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleCamera} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} title={camOff ? 'Turn camera on' : 'Turn camera off'}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${camOff ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
              {camOff ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              )}
            </button>
          </div>

          {/* Leave call */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={leaveCall} aria-label="Leave Call" title="Leave Call"
              className="w-[72px] h-[72px] rounded-full bg-danger flex items-center justify-center text-white hover:bg-danger/80 transition-colors"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
          </div>

          {/* Chat */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative">
              <button onClick={chatOpen ? () => setChatOpen(false) : openChat} aria-label={chatOpen ? 'Close chat' : 'Open chat'} title={chatOpen ? 'Close chat' : 'Open chat'}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/15 hover:bg-white/25'}`}>
                <MessageCircle className="w-5 h-5 text-white" />
              </button>
              {chatUnreadCount > 0 && !chatOpen && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0A0A0A]">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setShowInfoPanel(true)} aria-label="Consultation info" title="Consultation info"
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all bg-white/15 hover:bg-white/25">
              <Info className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <ConsultationInfoPanel
        open={showInfoPanel}
        onClose={() => setShowInfoPanel(false)}
        consultationId={id as string}
        consultationType="video"
        counterpartLabel="Doctor"
        counterpartName={`Dr. ${doctorName}`}
        counterpartPhotoUrl={consultation?.doctor?.user?.profile_photo_url ?? null}
        startedAt={state.startedAtIso}
        elapsedSeconds={elapsed}
        networkQuality={networkQuality}
      />

      {/* Chat panel — identical ConsultationChatThread used by the standalone
          chat page and the phone-consultation drawer. Always mounted from
          page load (visibility toggled via CSS, never unmounted) so the
          Stream channel is watched and its message.new listener is live
          immediately — otherwise the very first message from the peer would
          arrive before any subscription exists and the unread badge would
          miss it. Scroll position and the subscription also survive
          closing/reopening. */}
      <div className={`bg-white flex flex-col overflow-hidden transition-all duration-300 ease-out
          max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:rounded-t-2xl max-md:border-t max-md:border-steel-grey
          md:border-l md:border-steel-grey
          ${chatOpen ? 'md:w-80 max-md:h-[75vh]' : 'md:w-0 max-md:h-0 max-md:translate-y-full'}`}
        >
          <div className="w-full md:w-80 h-full flex flex-col">
            <ConsultationChatThread
              consultationId={id as string}
              role="patient"
              variant="drawer"
              onClose={() => setChatOpen(false)}
              isVisible={chatOpen}
              onUnreadMessage={(n = 1) => setChatUnreadCount(c => c + n)}
            />
          </div>
        </div>
    </div>
  )
}
