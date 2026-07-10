'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'
import { uidFromString, fetchAgoraToken, trackAgoraLeave, waitForPendingAgoraLeave, classifyMediaError } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { stripDrPrefix } from '@/lib/utils'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { ConsultationInfoPanel } from '@/components/consultation/ConsultationInfoPanel'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'
import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { MessageCircle, Info, Video, VideoOff, CameraOff } from 'lucide-react'
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
  const [camOff, setCamOff] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  const [isReconnecting, setIsReconnecting] = useState(false)
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

  const displayStatus: CallStatus = !ringingDismissed
    ? 'ringing'
    : errorMessage
    ? 'error'
    : state.phase === 'ended'
    ? 'ended'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? 'connected'
    : state.phase === 'waiting_for_doctor'
    ? 'waiting'
    : 'connecting'

  // Once the DB-derived phase reaches 'ended', release local Agora resources
  // exactly once.
  const endedCleanupDoneRef = useRef(false)
  useEffect(() => {
    if (state.phase !== 'ended' || endedCleanupDoneRef.current) return
    endedCleanupDoneRef.current = true
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
    cleanupAgora()
  }, [state.phase])

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

      // Shared "show reconnecting for up to 90s" logic, used for both a remote
      // disconnect (doctor's side drops) and a local network drop (our own
      // connection-state-change) so the two paths can't diverge.
      function enterReconnecting() {
        isReconnectingLocal = true
        setRemoteMuted(false)
        setRemoteCamOff(false)
        setIsReconnecting(true)
        setReconnectCountdown(90)
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
        if (reconnectCountdownRef.current) clearInterval(reconnectCountdownRef.current)
        reconnectTimerRef.current = setTimeout(() => {
          if (!agoraStartedRef.current) return
          setIsReconnecting(false)
          setErrorMessage('Unable to reconnect. Please check your network and try again.')
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

      // ── (18) user-joined ─────────────────────────────────────────────────
      client.on('user-joined', (remoteUser) => {
        logger.log(`[Video][Patient][${Date.now()}] user-joined uid:${remoteUser.uid}`)
      })

      // ── (19) user-published ──────────────────────────────────────────────
      client.on('user-published', async (remoteUser, mediaType) => {
        logger.log(`[Video][Patient][${Date.now()}] user-published uid:${remoteUser.uid} type:${mediaType}`)
        await client.subscribe(remoteUser, mediaType)
        logger.log(`[Video][Patient][${Date.now()}] subscribed uid:${remoteUser.uid} type:${mediaType}`)

        // This only reflects that the doctor's media arrived on our own Agora
        // connection — it no longer decides call phase or the timer. Both are
        // derived solely from the DB row (see useConsultationState), which is
        // written to only by each party's own publish-success.
        if (mediaType === 'video') {
          if (remoteVideoRef.current) remoteUser.videoTrack?.play(remoteVideoRef.current)
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
        // Keep timer running — doctor may reconnect within grace period
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
      const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks()
      logger.log(`[Video][Patient][${Date.now()}] createMicrophoneAndCameraTracks — mic and cam tracks ready. mic.enabled:${mic.enabled} mic.muted:${mic.muted} cam.enabled:${cam.enabled}`)
      micTrackRef.current = mic
      camTrackRef.current = cam
      // Re-apply the user's chosen mute state to this (possibly brand-new,
      // post-retry) track — a fresh track always defaults to enabled.
      mic.setEnabled(!mutedRef.current)
      if (localVideoRef.current) cam.play(localVideoRef.current)

      // ── (16-17) Publish ──────────────────────────────────────────────────
      logger.log(`[Video][Patient][${Date.now()}] client.publish — publishing mic+cam`)
      await client.publish([mic, cam])
      logger.log(`[Video][Patient][${Date.now()}] client.publish — done. localTracks published:${client.localTracks.map(t => t.trackMediaType).join(',')} mic.enabled:${mic.enabled} — waiting for doctor`)
      // Our own join+publish succeeded — report only our own milestone. The
      // DB trigger flips status/started_at once the doctor's own write lands
      // too; both clients learn of it from the same row update.
      state.markSelfConnected()
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

  function leaveCall() {
    const isActive = displayStatus === 'connected' || displayStatus === 'waiting'
    if (isActive && !window.confirm('Are you sure you want to leave the consultation? The doctor will be notified.')) return
    cleanupAgora()
    router.push('/patient')
  }

  function openChat() {
    setChatOpen(true)
    setChatUnreadCount(0)
  }

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
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
  if (displayStatus === 'ended') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center"><VideoOff className="w-10 h-10 text-white/70" /></div>
        <div className="text-center">
          <h1 className="font-montserrat font-black text-2xl text-white mb-2">Call Ended</h1>
          <p className="text-white/50 text-sm">The doctor has ended the consultation.</p>
        </div>
        <button
          onClick={() => router.push('/patient')}
          className="btn-primary px-8 py-3 rounded-2xl text-sm"
        >
          Back to Dashboard
        </button>
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

          {/* Placeholder when no remote video */}
          {displayStatus !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-40 h-40 rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white font-black text-6xl mx-auto mb-4 shadow-lg overflow-hidden">
                  {doctorPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={doctorPhotoUrl} alt={doctorName} className="w-full h-full object-cover" />
                  ) : (
                    doctorName.charAt(0)
                  )}
                </div>
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
                ) : (
                  <p className="text-white/40 text-xs mt-1">
                    {STATUS_LABEL[displayStatus]}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Doctor camera off overlay */}
          {displayStatus === 'connected' && remoteCamOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#111827]/90 pointer-events-none">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-2">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </div>
                <p className="text-white/40 text-xs">Camera off</p>
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

          {/* Timer + LIVE + Network — only once actually connected; never show
              LIVE/00:00 while still connecting/waiting/reconnecting */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <div className="bg-black/50 rounded-full px-3 py-1.5 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${displayStatus === 'connected' ? 'bg-danger' : 'bg-white/40'}`} />
              <span className="text-white text-xs font-bold tracking-wider">
                {displayStatus === 'connected' ? 'LIVE' : displayStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
              </span>
            </div>
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
              <span className="text-white font-mono text-sm">{displayStatus === 'connected' || displayStatus === 'reconnecting' ? formatTime(elapsed) : '--:--'}</span>
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

          {/* Local camera — bottom right corner */}
          <div className="absolute bottom-4 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-lg bg-[#1F2937]">
            <div ref={localVideoRef} className="absolute inset-0" />
            {camOff && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/40">
                <CameraOff className="w-6 h-6" />
                <span className="text-[9px]">Camera off</span>
              </div>
            )}
            <span className="absolute bottom-1 left-0 right-0 text-center text-white/60 text-[9px] z-10">You</span>
          </div>
        </div>

        {/* Controls bar */}
        <div className="bg-black/85 px-6 py-5 flex items-center justify-center gap-6">
          {/* Mute */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleMute}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
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
            <span className="text-white/50 text-[10px]">{muted ? 'Unmute' : 'Mute'}</span>
          </div>

          {/* Camera */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setCamOff(c => !c)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${camOff ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
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
            <span className="text-white/50 text-[10px]">{camOff ? 'Cam On' : 'Cam Off'}</span>
          </div>

          {/* Leave call */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={leaveCall}
              className="w-16 h-16 rounded-full bg-danger flex items-center justify-center text-white hover:bg-danger/80 transition-colors"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
            <span className="text-white/50 text-[10px]">Leave</span>
          </div>

          {/* Chat */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative">
              <button onClick={chatOpen ? () => setChatOpen(false) : openChat}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/15 hover:bg-white/25'}`}>
                <MessageCircle className="w-5 h-5 text-white" />
              </button>
              {chatUnreadCount > 0 && !chatOpen && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0A0A0A]">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </div>
            <span className="text-white/50 text-[10px]">Chat</span>
          </div>

          {/* Info */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setShowInfoPanel(true)}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all bg-white/15 hover:bg-white/25">
              <Info className="w-5 h-5 text-white" />
            </button>
            <span className="text-white/50 text-[10px]">Info</span>
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
