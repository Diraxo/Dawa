'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'
import { uidFromString, fetchAgoraToken, trackAgoraLeave, waitForPendingAgoraLeave, classifyMediaError } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { getPersistedCameraOff, setPersistedCameraOff } from '@/lib/callCameraStorage'
import { useUserPhotoRealtime } from '@/hooks/useUserPhotoRealtime'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import { ConsultationInfoPanel } from '@/components/consultation/ConsultationInfoPanel'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'
import { DraggableSelfView } from '@/components/consultation/DraggableSelfView'
import { SpeakingPulse } from '@/components/consultation/SpeakingPulse'
import { MessageCircle, Info, VideoOff, CameraOff } from 'lucide-react'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { getAuthClient } from '@/lib/supabase'
import { useConsultationState } from '@/hooks/useConsultationState'
import { formatCallDuration } from '@/lib/callDuration'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, ICameraVideoTrack } from 'agora-rtc-sdk-ng'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  patient: { id: string; full_name: string; clerk_id: string; profile_photo_url: string | null } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error' | 'ended'

export default function DoctorVideoConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  // Must be called unconditionally on every render (Rules of Hooks) — kept
  // above the `if (loading) return` below rather than after it.
  const patientPhotoUrl = useUserPhotoRealtime(consultation?.patient?.id, consultation?.patient?.profile_photo_url)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(() => getPersistedMute(id))
  // Bare useState(false) previously meant "camera off" silently reset to
  // "on" on every refresh/reconnect — mirror the mute-persistence pattern.
  const [camOff, setCamOff] = useState(() => getPersistedCameraOff(id))
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  const [isReconnecting, setIsReconnecting] = useState(false)
  // True once this client has actually observed the patient's peer publish
  // media — the DB phase alone only proves each side's OWN join succeeded,
  // not that the two are actually connected to each other.
  const [remotePeerPresent, setRemotePeerPresent] = useState(false)
  const [, setReconnectCountdown] = useState(90)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [remoteCamOff, setRemoteCamOff] = useState(false)
  // Driven by Agora's volume-indicator event — who's currently talking, for
  // the speaking-indicator pulse (self view for the doctor, the patient's
  // avatar/video area for the patient).
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const [remoteSpeaking, setRemoteSpeaking] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [networkQuality, setNetworkQuality] = useState(0)
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
  const camTrackRef = useRef<ICameraVideoTrack | null>(null)
  const remoteVideoRef = useRef<HTMLDivElement>(null)
  const localVideoRef = useRef<HTMLDivElement>(null)
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
  const endedAtMountRef = useRef(false)

  // Single source of truth for call phase/timer — derived from the DB row via
  // Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: id as string, role: 'doctor', localAgoraReconnecting: isReconnecting })
  const phaseRef = useRef(state.phase)
  useEffect(() => { phaseRef.current = state.phase }, [state.phase])
  const markSelfConnectedRef = useRef(state.markSelfConnected)
  useEffect(() => { markSelfConnectedRef.current = state.markSelfConnected }, [state.markSelfConnected])

  // `remotePeerPresent` gates 'connected' too, not just phase — the DB-driven
  // phase only proves each side's OWN join succeeded, not that this client
  // has actually received the patient's media (see user-published handler).
  const displayStatus: CallStatus = errorMessage
    ? 'error'
    : state.phase === 'ended'
    ? 'ended'
    : state.phase === 'reconnecting'
    ? 'reconnecting'
    : state.phase === 'on_call'
    ? (remotePeerPresent ? 'connected' : 'connecting')
    : state.phase === 'waiting_for_patient'
    ? 'waiting'
    : 'connecting'

  // The doctor's ability to complete the consultation must never depend on
  // the patient's connection state — reconnecting, offline, backgrounded, or
  // erroring out mid-call are all still a live, billable consultation with a
  // summary to fill in. `state.startedAtIso` (set once both sides' own joins
  // landed — see migration 035) distinguishes "this call genuinely started
  // and then had trouble" from "this outgoing call never connected at all",
  // which still just gets a plain cancel (nothing to summarize). Mirrors the
  // doctor phone page's gate — this page previously had none, so End always
  // opened the summary sheet even for a never-answered outgoing call.
  const canEndWithSummary = displayStatus === 'connected'
    || displayStatus === 'waiting'
    || displayStatus === 'reconnecting'
    || (displayStatus === 'error' && !!state.startedAtIso)

  // Leaves the current Agora session and tracks the leave so a subsequent
  // join for this channel (remount, retry) always waits for it to fully
  // complete instead of racing it — an overlapping join+leave on the same
  // UID is what causes UID_CONFLICT.
  async function leaveAgora() {
    if (!agoraClientRef.current) return
    const client = agoraClientRef.current
    agoraClientRef.current = null
    const leaving = client.leave().catch(() => {})
    trackAgoraLeave(id as string, leaving)
    await leaving
  }

  // Single source of truth for the "call ended" reaction — release local
  // Agora resources exactly once. Doctor gets no completion modal (a
  // deliberate, preserved asymmetry vs. the patient side) — this page keeps
  // its own plain "Call Ended" panel, gated on completion.isCompleted below.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'doctor',
    kind: 'video',
    consultationId: id as string,
    onTeardown: () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
      micTrackRef.current?.close(); micTrackRef.current = null
      camTrackRef.current?.close(); camTrackRef.current = null
      leaveAgora()
    },
  })

  // Also active during 'reconnecting' — the server-side stale-session cron
  // (mark_stale_active_consultations, migration 023) kills any in_progress
  // call whose heartbeat has gone quiet for 10 minutes. Pausing the
  // heartbeat only during a temporary network drop means a call that
  // flaps in and out of reconnecting for a while (without ever getting a
  // full clean 30s window) can get silently ended_abnormally by the cron
  // even though the doctor never gave up on it.
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

  // Load consultation display data and bail out of the Agora join entirely if
  // the consultation was already terminal on mount. Call phase/timer
  // themselves come from useConsultationState, not from here.
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, status, started_at, patient:users!patient_id(id, full_name, clerk_id, profile_photo_url)')
        .eq('id', id)
        .single()
      setConsultation(data as unknown as Consultation)
      const status = (data as unknown as Consultation)?.status
      if (status === 'completed' || status === 'ended_abnormally' || status === 'missed' || status === 'call_declined') {
        endedAtMountRef.current = true
      }
      setLoading(false)
    }
    load()
  }, [id])

  // Agora video call
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
    if (!appId || !id || !user) return
    const appIdStr = appId as string
    const channelId = id as string
    let mounted = true

    async function joinCall() {
      try {
        if (endedAtMountRef.current) return

        logger.log(`[Video][Doctor][${Date.now()}] === AGORA JOIN START ===`)
        logger.log(`[Video][Doctor][${Date.now()}] consultationId:${channelId} | role:doctor | type:video`)

        // Request mic+camera permission BEFORE fetching tokens or creating the
        // Agora client — matches the patient page's join order exactly, so
        // the browser prompt/grant happens first and nothing else is holding
        // or probing the devices while permission is being resolved.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
          stream.getTracks().forEach(t => t.stop())
        } catch (permErr) {
          if (!mounted) return
          const { name, genuinelyDenied } = classifyMediaError(permErr)
          logger.error(`[Video][Doctor][${Date.now()}] getUserMedia failed (${name}) — genuinelyDenied:${genuinelyDenied}`)
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
        if (!mounted) return

        const clerkToken = await getToken()
        if (!clerkToken || !mounted || endedAtMountRef.current) return

        const uid = uidFromString(user!.id)
        const maskedAppId = appIdStr.length > 8
          ? `${appIdStr.slice(0, 4)}…${appIdStr.slice(-4)}`
          : '(short-id)'

        // ── (3) App ID  (4) Channel  (5) UID ─────────────────────────────────
        logger.log(`[Video][Doctor][${Date.now()}] appId (masked):${maskedAppId} appIdLen:${appIdStr.length}`)
        logger.log(`[Video][Doctor][${Date.now()}] channel:${channelId} | uid:${uid}`)

        // ── (6-8) Token ───────────────────────────────────────────────────────
        logger.log(`[Video][Doctor][${Date.now()}] Fetching Agora token…`)
        const { token: agoraToken, expiresAt } = await fetchAgoraToken(channelId, uid, clerkToken)
        const tokenExpiresIso = new Date(expiresAt * 1000).toISOString()
        logger.log(`[Video][Doctor][${Date.now()}] token exists:${!!agoraToken} len:${agoraToken?.length ?? 0} expires:${tokenExpiresIso}`)
        if (!mounted) return

        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng')
        if (!mounted) return

        logger.log(`[Video][Doctor][${Date.now()}] createClient — mode:rtc codec:vp8`)
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        agoraClientRef.current = client

        // Tracks whether we're mid-reconnect so a spurious user-unpublished
        // firing purely from the network blip (not a real mute/camera-off) is
        // ignored — reconnecting must never be interpreted as a real mute.
        let isReconnectingLocal = false

        // Shared "show reconnecting" logic, used for both a remote disconnect
        // (patient's side drops) and a local network drop (our own
        // connection-state-change) so the two paths can't diverge. Network
        // issues must never end the consultation or block the UI with a
        // Retry/Leave dialog — only an explicit End Consultation action may
        // end the call. The Agora SDK keeps retrying the same session
        // internally, so this just keeps reflecting "Reconnecting…" for as
        // long as it takes, the same as the native app.
        function enterReconnecting() {
          if (!mounted) return
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
            if (!mounted) return
            logger.warn(`[Video][Doctor][${Date.now()}] 90s reconnect window elapsed — still reconnecting, not ending call`)
            startReconnectLoop()
          }, 90000)
          reconnectCountdownRef.current = setInterval(() => {
            setReconnectCountdown(c => {
              if (c <= 1) { if (reconnectCountdownRef.current) clearInterval(reconnectCountdownRef.current); return 0 }
              return c - 1
            })
          }, 1000)
        }
        function exitReconnecting() {
          isReconnectingLocal = false
          setIsReconnecting(false)
          // Whatever mute/camera state we inferred while the connection was
          // flaky is not trustworthy — a fresh publish event (if the remote
          // is truly still muted/camera-off) will set it again.
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
                // Cast breaks stale TS control-flow narrowing carried over
                // from the `!remoteUser.audioTrack` guard above — subscribe()
                // populates this at runtime but TS can't see that.
                const audioTrack = (remoteUser as any).audioTrack
                audioTrack?.play()
                logger.log(`[Video][Doctor][${Date.now()}] resubscribed audio uid:${remoteUser.uid}`)
              } catch (e) {
                logger.error(`[Video][Doctor][${Date.now()}] resubscribe audio failed uid:${remoteUser.uid}:`, e)
              }
            }
            if (remoteUser.hasVideo && !remoteUser.videoTrack) {
              try {
                await client.subscribe(remoteUser, 'video')
                const videoTrack = (remoteUser as any).videoTrack
                if (remoteVideoRef.current) videoTrack?.play(remoteVideoRef.current, { fit: 'contain' })
                logger.log(`[Video][Doctor][${Date.now()}] resubscribed video uid:${remoteUser.uid}`)
              } catch (e) {
                logger.error(`[Video][Doctor][${Date.now()}] resubscribe video failed uid:${remoteUser.uid}:`, e)
              }
            }
          }
          // The patient is still in client.remoteUsers even if nothing needed
          // resubscribing (e.g. only OUR connection blipped) — either way,
          // their presence here means media is flowing again, so the
          // timer/LIVE badge can resume.
          if (client.remoteUsers.length > 0) setRemotePeerPresent(true)
        }

        // ── (21) Connection-state changes ────────────────────────────────────
        client.on('connection-state-change', (curState, prevState, reason) => {
          logger.log(`[Video][Doctor][${Date.now()}] connectionStateChange ${prevState}→${curState} reason:${reason}`)
          if (!mounted) return
          if ((curState === 'RECONNECTING' || curState === 'DISCONNECTED') && prevState === 'CONNECTED') {
            logger.error(`[Video][Doctor][${Date.now()}] Local connection lost reason:${reason} — reconnecting`)
            enterReconnecting()
          } else if (curState === 'CONNECTED' && (prevState === 'RECONNECTING' || prevState === 'DISCONNECTED')) {
            logger.log(`[Video][Doctor][${Date.now()}] Local connection restored`)
            exitReconnecting()
          }
        })

        // ── (22) SDK exceptions (non-fatal errors) ───────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('exception', (event: any) => {
          logger.error(`[Video][Doctor][${Date.now()}] SDK exception code:${event?.code} msg:${event?.msg}`)
        })

        client.on('token-privilege-will-expire', async () => {
          logger.log(`[Video][Doctor][${Date.now()}] Token privilege will expire — renewing`)
          try {
            const tok = await getToken()
            if (!tok) return
            const { token: newToken } = await fetchAgoraToken(channelId, uid, tok)
            await client.renewToken(newToken)
            logger.log(`[Video][Doctor][${Date.now()}] Token renewed`)
          } catch (e) { logger.error(`[Video][Doctor][${Date.now()}] Token renewal failed:`, e) }
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('network-quality', (stats: any) => {
          setNetworkQuality(Math.max(stats.uplinkNetworkQuality ?? 0, stats.downlinkNetworkQuality ?? 0))
        })

        // Speaking-indicator pulse — reports both the local user's own
        // volume and the patient's, distinguished by uid.
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
          logger.log(`[Video][Doctor][${Date.now()}] user-joined uid:${remoteUser.uid}`)
        })

        // ── (19) user-published ──────────────────────────────────────────────
        client.on('user-published', async (remoteUser, mediaType) => {
          logger.log(`[Video][Doctor][${Date.now()}] user-published uid:${remoteUser.uid} type:${mediaType}`)
          try {
            await client.subscribe(remoteUser, mediaType)
          } catch (e) {
            // Can race a local connection drop (peerConnection already
            // disconnected when this fires) — exitReconnecting()'s sweep
            // picks it up once the connection is restored. Must not throw
            // out of an event handler: an unhandled rejection here crashes
            // the whole call screen.
            logger.error(`[Video][Doctor][${Date.now()}] subscribe failed uid:${remoteUser.uid} type:${mediaType}:`, e)
            return
          }
          logger.log(`[Video][Doctor][${Date.now()}] subscribed uid:${remoteUser.uid} type:${mediaType}`)

          if (mediaType === 'video' && remoteVideoRef.current) {
            remoteUser.videoTrack?.play(remoteVideoRef.current, { fit: 'contain' })
          }
          if (mediaType === 'audio') {
            if (!remoteUser.audioTrack) {
              logger.error(`[Video][Doctor][${Date.now()}] user-published audio but remoteUser.audioTrack is missing after subscribe — nothing to play`)
            } else {
              remoteUser.audioTrack.play()
              logger.log(`[Video][Doctor][${Date.now()}] playing remote audio — track exists, isPlaying will follow`)
            }
          }

          // Call phase/timer come from the DB row (see useConsultationState),
          // but that only proves each side's OWN join succeeded — not that
          // this client has actually received the patient's media. Gate
          // `displayStatus === 'connected'` on this too so the timer/LIVE
          // badge never runs while the video area is still a black/placeholder
          // screen (item 4).
          if (mounted) {
            setRemotePeerPresent(true)
            if (reconnectDebounceRef.current) { clearTimeout(reconnectDebounceRef.current); reconnectDebounceRef.current = null }
            if (mediaType === 'audio') setRemoteMuted(false)
            if (mediaType === 'video') setRemoteCamOff(false)
            setIsReconnecting(false)
            if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
            if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
          }
        })

        client.on('user-unpublished', (remoteUser, mediaType) => {
          logger.log(`[Video][Doctor][${Date.now()}] user-unpublished uid:${remoteUser.uid} type:${mediaType}`)
          if (!mounted || isReconnectingLocal) return
          if (mediaType === 'audio') setRemoteMuted(true)
          if (mediaType === 'video') setRemoteCamOff(true)
        })

        // ── (20) user-left ───────────────────────────────────────────────────
        client.on('user-left', (remoteUser, reason) => {
          logger.log(`[Video][Doctor][${Date.now()}] user-left uid:${remoteUser.uid} reason:${reason}`)
          // enterReconnecting() clears remotePeerPresent too — patient may
          // reconnect within the grace period, at which point a fresh
          // user-published sets it again.
          enterReconnecting()
        })

        // ── (9) Join ─────────────────────────────────────────────────────────
        const _diagNow = Math.floor(Date.now() / 1000)
        logger.log(`[Video][Doctor] [PRE-JOIN] Token length:${agoraToken?.length ?? 0}`)
        logger.log(`[Video][Doctor] [PRE-JOIN] Token expiresAt:${new Date(expiresAt * 1000).toISOString()}`)
        logger.log(`[Video][Doctor] [PRE-JOIN] Current browser time:${new Date(_diagNow * 1000).toISOString()}`)
        logger.log(`[Video][Doctor] [PRE-JOIN] Seconds until expiration:${expiresAt - _diagNow}`)
        logger.log(`[Video][Doctor] [PRE-JOIN] Channel:${channelId}`)
        logger.log(`[Video][Doctor] [PRE-JOIN] UID:${uid}`)
        logger.log(`[Video][Doctor][${Date.now()}] client.join → channel:${channelId} uid:${uid}`)
        // Never join while a previous session's leave() for this channel is
        // still in flight — that race is what triggers UID_CONFLICT.
        await waitForPendingAgoraLeave(channelId)
        if (endedAtMountRef.current) return
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Join timeout — check network or Agora credentials')), 30000)
          client.join(appIdStr, channelId, agoraToken, uid).then(() => { clearTimeout(t); resolve() }).catch(err => { clearTimeout(t); reject(err) })
        })
        logger.log(`[Video][Doctor][${Date.now()}] client.join succeeded`)
        if (!mounted) return

        // ── (14-15) Local tracks ─────────────────────────────────────────────
        logger.log(`[Video][Doctor][${Date.now()}] createMicrophoneAndCameraTracks — requesting`)
        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks(
          { AEC: true, AGC: true, ANS: true, encoderConfig: 'speech_standard' },
          { encoderConfig: { width: 960, height: 540, frameRate: 24, bitrateMin: 600, bitrateMax: 1200 } }
        )
        logger.log(`[Video][Doctor][${Date.now()}] createMicrophoneAndCameraTracks — mic and cam tracks ready. mic.enabled:${mic.enabled} mic.muted:${mic.muted} cam.enabled:${cam.enabled}`)
        micTrackRef.current = mic
        // Re-apply the user's chosen mute/camera state to this (possibly
        // brand-new, post-retry) track — a fresh track always defaults to
        // enabled.
        mic.setEnabled(!mutedRef.current)
        camTrackRef.current = cam
        cam.setEnabled(!camOffRef.current)
        if (!mounted) { mic.close(); cam.close(); return }

        if (localVideoRef.current) {
          cam.play(localVideoRef.current, { fit: 'contain' })
        }

        // ── (16-17) Publish ──────────────────────────────────────────────────
        logger.log(`[Video][Doctor][${Date.now()}] client.publish — publishing mic+cam`)
        await client.publish([mic, cam])
        logger.log(`[Video][Doctor][${Date.now()}] client.publish — done. localTracks published:${client.localTracks.map(t => t.trackMediaType).join(',')} mic.enabled:${mic.enabled} — waiting for patient`)
        // Our own join+publish succeeded — report only our own milestone. The
        // DB trigger flips status/started_at once the patient's own write
        // lands too; both clients learn of it from the same row update.
        markSelfConnectedRef.current()
      } catch (err) {
        logger.error(`[Video][Doctor][${Date.now()}] Fatal join error:`, err)
        if (mounted) {
          const msg = err instanceof Error && err.message.includes('timeout')
            ? 'Connection timed out. Please check your network and try again.'
            : 'Unable to connect. Please check your network and try again.'
          setErrorMessage(msg)
        }
      }
    }

    joinCall()

    return () => {
      mounted = false
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
      if (reconnectDebounceRef.current) { clearTimeout(reconnectDebounceRef.current); reconnectDebounceRef.current = null }
      micTrackRef.current?.close()
      micTrackRef.current = null
      camTrackRef.current?.close()
      camTrackRef.current = null
      leaveAgora()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, retryKey])

  useEffect(() => { micTrackRef.current?.setEnabled(!muted) }, [muted])
  useEffect(() => { camTrackRef.current?.setEnabled(!camOff) }, [camOff])

  // Keyboard shortcuts: M = toggle mute, Esc = close chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'm' || e.key === 'M') toggleMute()
      if (e.key === 'Escape') setChatOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openChat() {
    setChatOpen(true)
    setChatUnreadCount(0)
  }

  function handleEndDone() {
    completion.markHandled()
    micTrackRef.current?.close()
    camTrackRef.current?.close()
    leaveAgora()
    clearPersistedMute(id)
    router.replace('/doctor/consultations')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-white/40 text-sm">Connecting…</div>
      </div>
    )
  }

  const patientName = consultation?.patient?.full_name ?? 'Patient'
  const elapsed = state.elapsedSeconds ?? 0

  if (displayStatus === 'ended') {
    const endedCopy = state.rawStatus === 'call_declined'
      ? { title: 'Call Declined', body: 'The patient has declined the call.' }
      : state.rawStatus === 'missed'
      ? { title: 'Missed Call', body: 'The patient did not answer the call.' }
      : { title: 'Call Ended', body: 'The consultation has ended.' }
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center"><VideoOff className="w-10 h-10 text-white/70" /></div>
        <div className="text-center">
          <h1 className="font-montserrat font-black text-2xl text-white mb-2">{endedCopy.title}</h1>
          <p className="text-white/50 text-sm">{endedCopy.body}</p>
        </div>
        <button onClick={() => router.push('/doctor/consultations')} className="btn-primary px-8 py-3 rounded-2xl text-sm">
          Back to Consultations
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id}
          patientName={patientName}
          elapsedSeconds={elapsed}
          onDone={handleEndDone}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Main video area */}
      <div className="flex-1 flex flex-col relative">
        {/* Remote video (patient) */}
        <div className="flex-1 relative bg-[#0D1A3A]">
          <div ref={remoteVideoRef} className="absolute inset-0" />

          {/* Avatar placeholder — shown any time live video isn't actually
              flowing (not connected yet, reconnecting, or camera off), so
              the patient's photo + name replaces a frozen frame or black
              screen immediately, with no delay. */}
          {(displayStatus !== 'connected' || remoteCamOff) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0D1A3A]">
              <div className="text-center">
                <SpeakingPulse active={remoteSpeaking && displayStatus === 'connected'} className="w-32 h-32 rounded-full mx-auto mb-4">
                  <div className="w-full h-full rounded-full bg-white/10 flex items-center justify-center text-white/20 text-5xl overflow-hidden">
                    {patientPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={patientPhotoUrl} alt={patientName} className="w-full h-full object-cover" />
                    ) : (
                      '👤'
                    )}
                  </div>
                </SpeakingPulse>
                <p className="text-white/50 text-base font-semibold">{patientName}</p>
                {displayStatus === 'error' ? (
                  <div className="mt-2 flex flex-col items-center gap-3 max-w-xs text-center">
                    <p className="text-danger/80 text-xs whitespace-pre-line">
                      {errorMessage || 'Connection failed. Check your camera/microphone permissions.'}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setErrorMessage(''); setRetryKey(k => k + 1) }}
                        className="text-white text-xs border border-white/30 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => { micTrackRef.current?.close(); camTrackRef.current?.close(); leaveAgora(); router.replace('/doctor/consultations') }}
                        className="text-white/70 text-xs border border-white/20 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                      >
                        Leave Consultation
                      </button>
                    </div>
                  </div>
                ) : displayStatus === 'connected' ? null : (
                  <p className="text-white/30 text-sm mt-1">
                    {displayStatus === 'connecting' ? 'Connecting…' :
                     state.patientHasLeft ? 'Patient has left the consultation' :
                     isReconnecting ? 'Reconnecting…' : 'Waiting for patient…'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Patient muted badge */}
          {displayStatus === 'connected' && remoteMuted && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 rounded-full px-3 py-1.5 pointer-events-none">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span className="text-white/80 text-xs">Patient is muted</span>
            </div>
          )}

          {/* Timer — only once both parties are actually connected;
              never show 00:00 while still connecting/waiting/reconnecting */}
          <div className="absolute top-6 left-0 right-0 flex items-center justify-end px-6">
            <div className="bg-black/50 rounded-full px-4 py-1.5">
              <span className="text-white font-mono text-sm">
                {displayStatus === 'connected' ? formatCallDuration(elapsed) : displayStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
              </span>
            </div>
          </div>

          {/* Self view — draggable, WhatsApp-style floating PiP, starts top-right */}
          <DraggableSelfView top={64} isOff={false} isSpeaking={localSpeaking}>
            <div ref={localVideoRef} className="absolute inset-0" />
            {camOff && (
              <div className="absolute inset-0 flex items-center justify-center text-white/40 bg-[#1F2937]">
                <CameraOff className="w-6 h-6" />
              </div>
            )}
          </DraggableSelfView>

        </div>

        {/* Controls bar */}
        <div className="px-6 py-5 bg-black/85 flex items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-care-blue' : 'bg-white/15 hover:bg-white/25'}`}>
              {muted ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button onClick={toggleCamera} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} title={camOff ? 'Turn camera on' : 'Turn camera off'}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${camOff ? 'bg-care-blue' : 'bg-white/15 hover:bg-white/25'}`}>
              {camOff ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              )}
            </button>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => {
                if (canEndWithSummary) {
                  setShowEndSheet(true)
                } else if (displayStatus === 'connecting' || displayStatus === 'error') {
                  if (confirm('Cancel this outgoing call?')) {
                    micTrackRef.current?.close()
                    camTrackRef.current?.close()
                    leaveAgora()
                    router.replace('/doctor/consultations')
                  }
                } else {
                  setShowEndSheet(true)
                }
              }}
              aria-label="End consultation" title="End consultation"
              className="w-[72px] h-[72px] rounded-full bg-danger flex items-center justify-center text-white hover:bg-danger/80 transition-colors"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="relative">
              <button onClick={chatOpen ? () => setChatOpen(false) : openChat} aria-label={chatOpen ? 'Close chat' : 'Open chat'} title={chatOpen ? 'Close chat' : 'Open chat'}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/15 hover:bg-white/25'}`}>
                <MessageCircle className="w-6 h-6 text-white" />
              </button>
              {chatUnreadCount > 0 && !chatOpen && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0A0A0A]">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setShowInfoPanel(true)} aria-label="Consultation info" title="Consultation info"
              className="w-16 h-16 rounded-full flex items-center justify-center transition-all bg-white/15 hover:bg-white/25">
              <Info className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </div>

      <ConsultationInfoPanel
        open={showInfoPanel}
        onClose={() => setShowInfoPanel(false)}
        consultationId={id as string}
        consultationType="video"
        counterpartLabel="Patient"
        counterpartName={patientName}
        counterpartPhotoUrl={patientPhotoUrl}
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
              role="doctor"
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
