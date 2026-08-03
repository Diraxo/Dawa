'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuth, useUser } from '@clerk/nextjs'
import { uidFromString, fetchAgoraToken, trackAgoraLeave, waitForPendingAgoraLeave, classifyMediaError } from '@/lib/agora'
import { getPersistedMute, setPersistedMute, clearPersistedMute } from '@/lib/callMuteStorage'
import { useUserPhotoRealtime } from '@/hooks/useUserPhotoRealtime'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import { ConsultationInfoPanel } from '@/components/consultation/ConsultationInfoPanel'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { formatCallDuration } from '@/lib/callDuration'
import { getAuthClient } from '@/lib/supabase'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'
import { MessageCircle, Info, PhoneOff } from 'lucide-react'
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  patient: { id: string; full_name: string; clerk_id: string; profile_photo_url: string | null } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error' | 'ended'

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for patient…',
  connected: 'On Call',
  reconnecting: 'Reconnecting…',
  error: 'Connection Lost',
  ended: 'Call Ended',
}

export default function DoctorPhoneConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(() => getPersistedMute(id))
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  // True once this client has actually observed the patient's peer publish
  // audio — the DB phase alone only proves each side's OWN join succeeded,
  // not that the two are actually connected to each other.
  const [remotePeerPresent, setRemotePeerPresent] = useState(false)
  const [, setReconnectCountdown] = useState(90)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [networkQuality, setNetworkQuality] = useState(0)
  const [showInfoPanel, setShowInfoPanel] = useState(false)

  const [retryKey, setRetryKey] = useState(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
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

  // Single source of truth for call phase/timer — derived from the DB row
  // (consultations.status/started_at/doctor_connected_at/patient_connected_at)
  // via Realtime, never from local Agora events. See hooks/useConsultationState.
  const state = useConsultationState({ consultationId: id as string, role: 'doctor', localAgoraReconnecting: isReconnecting })
  const phaseRef = useRef(state.phase)
  useEffect(() => { phaseRef.current = state.phase }, [state.phase])
  const markSelfConnectedRef = useRef(state.markSelfConnected)
  useEffect(() => { markSelfConnectedRef.current = state.markSelfConnected }, [state.markSelfConnected])

  // `remotePeerPresent` gates 'connected' too, not just phase — the DB-driven
  // phase only proves each side's OWN join succeeded, not that this client
  // has actually received the patient's audio (see user-published handler).
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
  // which still just gets a plain cancel (nothing to summarize).
  const canEndWithSummary = displayStatus === 'connected'
    || displayStatus === 'waiting'
    || displayStatus === 'reconnecting'
    || (displayStatus === 'error' && !!state.startedAtIso)

  // Leaves the current Agora session and tracks the leave so a subsequent
  // join for this channel (remount, retry, cancel+rejoin) always waits for it
  // to fully complete instead of racing it — an overlapping join+leave on the
  // same UID is what causes UID_CONFLICT.
  async function leaveAgora() {
    if (!agoraClientRef.current) return
    const client = agoraClientRef.current
    agoraClientRef.current = null
    const leaving = client.leave().catch(() => {})
    trackAgoraLeave(id as string, leaving)
    await leaving
  }

  // Single source of truth for the "call ended" reaction (peer ended the
  // call, doctor's own grace-period escalation wrote ended_abnormally, or
  // the row was already terminal on mount) — release local Agora resources
  // exactly once. Doctor gets no completion modal (a deliberate, preserved
  // asymmetry vs. the patient side) — this page keeps its own plain
  // "Call Ended" panel, gated on completion.isCompleted below.
  const completion = useConsultationCompletion({
    phase: state.phase,
    rawStatus: state.rawStatus,
    role: 'doctor',
    kind: 'phone',
    consultationId: id as string,
    onTeardown: () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
      if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      micTrackRef.current?.close(); micTrackRef.current = null
      leaveAgora()
    },
  })

  // Also active during 'reconnecting' — see doctor video page for why: the
  // server-side stale-session cron kills any in_progress call whose
  // heartbeat has gone quiet for 10 minutes, and pausing it during a
  // network blip risks the cron ending a call the doctor is still trying
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

  // Load consultation display data (patient name) and bail out of the Agora
  // join entirely if the consultation was already terminal on mount. Call
  // phase/timer themselves come from useConsultationState, not from here.
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

  // Agora audio call
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
    if (!appId || !id || !user) return
    const appIdStr = appId as string
    const channelId = id as string
    let mounted = true

    async function joinCall() {
      try {
        if (endedAtMountRef.current) return
        const clerkToken = await getToken()
        if (!clerkToken || !mounted || endedAtMountRef.current) return

        const uid = uidFromString(user!.id)
        const maskedAppId = appIdStr.length > 8
          ? `${appIdStr.slice(0, 4)}…${appIdStr.slice(-4)}`
          : '(short-id)'

        // ── (1) Consultation ID  (2) Role  (3) App ID  (4) Channel  (5) UID ──
        logger.log(`[Phone][Doctor][${Date.now()}] === AGORA JOIN START ===`)
        logger.log(`[Phone][Doctor][${Date.now()}] consultationId:${channelId} | role:doctor | type:phone`)
        logger.log(`[Phone][Doctor][${Date.now()}] appId (masked):${maskedAppId} appIdLen:${appIdStr.length}`)
        logger.log(`[Phone][Doctor][${Date.now()}] channel:${channelId} | uid:${uid}`)

        // ── (6-8) Token ───────────────────────────────────────────────────────
        logger.log(`[Phone][Doctor][${Date.now()}] Fetching Agora token…`)
        const { token: agoraToken, expiresAt } = await fetchAgoraToken(channelId, uid, clerkToken)
        const tokenExpiresIso = new Date(expiresAt * 1000).toISOString()
        logger.log(`[Phone][Doctor][${Date.now()}] token exists:${!!agoraToken} len:${agoraToken?.length ?? 0} expires:${tokenExpiresIso}`)
        if (!mounted) return

        // Pre-request mic permission so the browser dialog is surfaced early
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach(t => t.stop())
        } catch (permErr) {
          if (!mounted) return
          const { name, genuinelyDenied } = classifyMediaError(permErr)
          logger.error(`[Phone][Doctor][${Date.now()}] getUserMedia failed (${name}) — genuinelyDenied:${genuinelyDenied}`)
          setErrorMessage(
            genuinelyDenied
              ? 'Microphone access denied.\n\n' +
                'To fix: click the 🔒 icon in your browser address bar → ' +
                'Site settings → Microphone → Allow → then click Retry.'
              : 'Unable to access your microphone.\n\n' +
                'Another app or browser tab may be using it — close it, then tap Retry.'
          )
          return
        }
        if (!mounted) return

        logger.log(`[Phone][Doctor][${Date.now()}] importing agora-rtc-sdk-ng`)
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng')
        if (!mounted) return

        logger.log(`[Phone][Doctor][${Date.now()}] createClient — mode:rtc codec:vp8`)
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        agoraClientRef.current = client

        // Tracks whether we're mid-reconnect so a spurious user-unpublished
        // firing purely from the network blip (not a real mute) is ignored —
        // reconnecting must never be interpreted as "the other side muted".
        let isReconnectingLocal = false
        // Set true the first time the peer's audio arrives. Guards the
        // initial-connect timeout below from being armed (or left armed) once
        // the call is already healthy — user-published can fire before that
        // timeout is even set (it races client.publish/markSelfConnected).
        let peerAudioArrived = false

        // Shared "show reconnecting for up to 90s" logic, used for both a
        // remote disconnect (patient's side drops) and a local network drop
        // (our own connection-state-change) so the two paths can't diverge.
        function enterReconnecting() {
          if (!mounted) return
          isReconnectingLocal = true
          setRemoteMuted(false)
          setRemotePeerPresent(false)
          setIsReconnecting(true)
          setReconnectCountdown(90)
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          if (reconnectCountdownRef.current) clearInterval(reconnectCountdownRef.current)
          reconnectTimerRef.current = setTimeout(() => {
            if (!mounted) return
            setIsReconnecting(false)
            // Network issues must never end the consultation — only an explicit
            // End Consultation / Decline / Cancel action may. Surface a local
            // retry prompt but leave the DB status untouched so the patient
            // side keeps showing "Reconnecting…" and a real reconnect can
            // still resume the same consultation.
            logger.warn(`[Phone][Doctor][${Date.now()}] 90s reconnect grace period expired — prompting retry, not ending call`)
            setErrorMessage('Unable to reconnect. Please check your network and try again.')
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
          // Whatever mute state we inferred while the connection was flaky is
          // not trustworthy — a fresh publish event (if the remote is truly
          // still muted) will set it again.
          setRemoteMuted(false)
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
          if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
          // A user-published event that raced the disconnect (peerConnection
          // already down when we tried to subscribe) is dropped rather than
          // retried inline — sweep for any published-but-unsubscribed remote
          // audio now that the peerConnection is back up.
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
                logger.log(`[Phone][Doctor][${Date.now()}] resubscribed audio uid:${remoteUser.uid}`)
              } catch (e) {
                logger.error(`[Phone][Doctor][${Date.now()}] resubscribe audio failed uid:${remoteUser.uid}:`, e)
              }
            }
          }
          // The patient is still in client.remoteUsers even if nothing needed
          // resubscribing (e.g. only OUR connection blipped) — either way,
          // their presence here means audio is flowing again, so the
          // timer/LIVE badge can resume.
          if (client.remoteUsers.length > 0) setRemotePeerPresent(true)
        }

        // ── (21) Connection-state changes ────────────────────────────────────
        client.on('connection-state-change', (curState, prevState, reason) => {
          logger.log(`[Phone][Doctor][${Date.now()}] connectionStateChange ${prevState}→${curState} reason:${reason}`)
          if (!mounted) return
          if ((curState === 'RECONNECTING' || curState === 'DISCONNECTED') && prevState === 'CONNECTED') {
            logger.error(`[Phone][Doctor][${Date.now()}] Local connection lost reason:${reason} — reconnecting`)
            enterReconnecting()
          } else if (curState === 'CONNECTED' && (prevState === 'RECONNECTING' || prevState === 'DISCONNECTED')) {
            logger.log(`[Phone][Doctor][${Date.now()}] Local connection restored`)
            exitReconnecting()
          }
        })

        // ── (22) SDK exceptions (non-fatal errors) ───────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('exception', (event: any) => {
          logger.error(`[Phone][Doctor][${Date.now()}] SDK exception code:${event?.code} msg:${event?.msg}`)
        })

        client.on('token-privilege-will-expire', async () => {
          logger.log(`[Phone][Doctor][${Date.now()}] Token privilege will expire — renewing`)
          try {
            const tok = await getToken()
            if (!tok) return
            const { token: newAgoraToken } = await fetchAgoraToken(channelId, uid, tok)
            await client.renewToken(newAgoraToken)
            logger.log(`[Phone][Doctor][${Date.now()}] Token renewed`)
          } catch (e) { logger.error(`[Phone][Doctor][${Date.now()}] Token renewal failed:`, e) }
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on('network-quality', (stats: any) => {
          setNetworkQuality(Math.max(stats.uplinkNetworkQuality ?? 0, stats.downlinkNetworkQuality ?? 0))
        })

        // ── (18) user-joined — patient entered channel before publish ────────
        client.on('user-joined', (remoteUser) => {
          logger.log(`[Phone][Doctor][${Date.now()}] user-joined uid:${remoteUser.uid} — patient in channel, waiting for audio`)
        })

        // ── (19) user-published ──────────────────────────────────────────────
        client.on('user-published', async (remoteUser, mediaType) => {
          logger.log(`[Phone][Doctor][${Date.now()}] user-published uid:${remoteUser.uid} type:${mediaType}`)
          try {
            await client.subscribe(remoteUser, mediaType)
          } catch (e) {
            // Can race a local connection drop (peerConnection already
            // disconnected when this fires) — exitReconnecting()'s sweep
            // picks it up once the connection is restored. Must not throw
            // out of an event handler: an unhandled rejection here crashes
            // the whole call screen.
            logger.error(`[Phone][Doctor][${Date.now()}] subscribe failed uid:${remoteUser.uid} type:${mediaType}:`, e)
            return
          }
          logger.log(`[Phone][Doctor][${Date.now()}] subscribed uid:${remoteUser.uid} type:${mediaType}`)
          if (mediaType === 'audio') {
            if (!remoteUser.audioTrack) {
              logger.error(`[Phone][Doctor][${Date.now()}] user-published audio but remoteUser.audioTrack is missing after subscribe — nothing to play`)
            } else {
              remoteUser.audioTrack.play()
              logger.log(`[Phone][Doctor][${Date.now()}] playing remote audio — track exists`)
            }
            if (mounted) {
              // Call phase/timer come from the DB row (see
              // useConsultationState), but that only proves each side's OWN
              // join succeeded — not that this client has actually received
              // the patient's audio. Gate `displayStatus === 'connected'` on
              // this too so the timer/LIVE badge never runs before audio is
              // actually flowing.
              peerAudioArrived = true
              setRemotePeerPresent(true)
              if (reconnectDebounceRef.current) { clearTimeout(reconnectDebounceRef.current); reconnectDebounceRef.current = null }
              setRemoteMuted(false)
              setIsReconnecting(false)
              // Clear any pending "connection lost" state — the call is
              // demonstrably working again, so a stale error must not keep
              // the UI stuck on the error screen.
              setErrorMessage('')
              if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
              if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
              if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
            }
          }
        })

        client.on('user-unpublished', (remoteUser, mediaType) => {
          logger.log(`[Phone][Doctor][${Date.now()}] user-unpublished uid:${remoteUser.uid} type:${mediaType}`)
          // user-unpublished fires when the remote side mutes — not a disconnect.
          // But ignore it while we're already in a reconnect window: a network
          // blip can force an unpublish that has nothing to do with a real mute.
          if (mediaType === 'audio' && mounted && !isReconnectingLocal) setRemoteMuted(true)
        })

        // ── (20) user-left — patient truly disconnected (network drop / closed tab) ──
        client.on('user-left', (remoteUser, reason) => {
          logger.log(`[Phone][Doctor][${Date.now()}] user-left uid:${remoteUser.uid} reason:${reason}`)
          // Keep timer running — patient may reconnect within grace period
          enterReconnecting()
        })

        // ── (9) Join ─────────────────────────────────────────────────────────
        const _diagNow = Math.floor(Date.now() / 1000)
        logger.log(`[Phone][Doctor] [PRE-JOIN] Token length:${agoraToken?.length ?? 0}`)
        logger.log(`[Phone][Doctor] [PRE-JOIN] Token expiresAt:${new Date(expiresAt * 1000).toISOString()}`)
        logger.log(`[Phone][Doctor] [PRE-JOIN] Current browser time:${new Date(_diagNow * 1000).toISOString()}`)
        logger.log(`[Phone][Doctor] [PRE-JOIN] Seconds until expiration:${expiresAt - _diagNow}`)
        logger.log(`[Phone][Doctor] [PRE-JOIN] Channel:${channelId}`)
        logger.log(`[Phone][Doctor] [PRE-JOIN] UID:${uid}`)
        logger.log(`[Phone][Doctor][${Date.now()}] client.join → channel:${channelId} uid:${uid}`)
        // Never join while a previous session's leave() for this channel is
        // still in flight — that race is what triggers UID_CONFLICT.
        await waitForPendingAgoraLeave(channelId)
        if (endedAtMountRef.current) return
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Join timeout — check network or Agora credentials')), 30000)
          client.join(appIdStr, channelId, agoraToken, uid).then(() => { clearTimeout(t); resolve() }).catch(err => { clearTimeout(t); reject(err) })
        })
        logger.log(`[Phone][Doctor][${Date.now()}] client.join succeeded`)
        if (!mounted) return

        // ── (14-15) Local tracks ─────────────────────────────────────────────
        logger.log(`[Phone][Doctor][${Date.now()}] createMicrophoneAudioTrack — requesting`)
        const mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, AGC: true, ANS: true, encoderConfig: 'speech_standard' })
        logger.log(`[Phone][Doctor][${Date.now()}] createMicrophoneAudioTrack — mic track ready. mic.enabled:${mic.enabled} mic.muted:${mic.muted}`)
        micTrackRef.current = mic
        // Re-apply the user's chosen mute state to this (possibly brand-new,
        // post-retry) track — a fresh track always defaults to enabled.
        mic.setEnabled(!mutedRef.current)
        if (!mounted) { mic.close(); return }

        // ── (16-17) Publish ──────────────────────────────────────────────────
        logger.log(`[Phone][Doctor][${Date.now()}] client.publish — publishing mic`)
        await client.publish([mic])
        logger.log(`[Phone][Doctor][${Date.now()}] client.publish — done. localTracks published:${client.localTracks.map(t => t.trackMediaType).join(',')} mic.enabled:${mic.enabled} — waiting for patient audio`)
        // Our own join+publish succeeded — report only our own milestone. The
        // DB trigger flips status/started_at once the patient's own write
        // lands too; both clients learn of it from the same row update.
        markSelfConnectedRef.current()

        // 90-second timeout: patient has 60s ring + time to answer before we show error.
        // Skip arming it entirely if the peer's audio already arrived while we
        // were joining/publishing — otherwise this can fire late and re-set
        // errorMessage on a call that's already connected.
        if (!peerAudioArrived) {
          connectionTimeoutRef.current = setTimeout(() => {
            if (mounted && !peerAudioArrived && phaseRef.current !== 'on_call') {
              logger.error(`[Phone][Doctor][${Date.now()}] Connection timeout after 90s — no remote audio published`)
              setErrorMessage('Unable to connect. Please check your network and try again.')
            }
          }, 90000)
        }
      } catch (err) {
        logger.error(`[Phone][Doctor][${Date.now()}] Fatal join error:`, err)
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
      if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null }
      micTrackRef.current?.close()
      micTrackRef.current = null
      leaveAgora()
    }
  // retryKey allows re-triggering a fresh join after error
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, retryKey])

  // Sync mute
  useEffect(() => {
    micTrackRef.current?.setEnabled(!muted)
  }, [muted])

  // Keyboard shortcuts: M = toggle mute, Esc = close chat/info panels
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
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
    micTrackRef.current?.close()
    leaveAgora()
    clearPersistedMute(id)
    router.replace('/doctor/consultations')
  }

  // Must be called unconditionally on every render (Rules of Hooks) — kept
  // above the `if (loading) return` below rather than after it.
  const patientPhotoUrl = useUserPhotoRealtime(consultation?.patient?.id, consultation?.patient?.profile_photo_url)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070E27] flex items-center justify-center">
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
      <div className="min-h-screen bg-[#070E27] flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center"><PhoneOff className="w-10 h-10 text-white/70" /></div>
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
    <div className="min-h-screen bg-[#070E27] flex">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id}
          patientName={patientName}
          elapsedSeconds={elapsed}
          onDone={handleEndDone}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Main call area */}
      <div className={`flex flex-col items-center justify-between p-6 py-14 transition-all duration-300 ${chatOpen ? 'flex-1' : 'w-full'}`}>
        {/* Patient info */}
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-2 mb-8">
            {(displayStatus === 'connecting' || displayStatus === 'waiting' || (displayStatus === 'reconnecting' && !state.patientHasLeft)) && (
              <svg className="animate-spin w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            <p className={`text-xs uppercase tracking-widest font-bold ${
              displayStatus === 'connected' ? 'text-teal-green' :
              displayStatus === 'reconnecting' ? (state.patientHasLeft ? 'text-white/50' : 'text-yellow-400') :
              displayStatus === 'error' ? 'text-danger' : 'text-white/50'
            }`}>
              {/* patientHasLeft (patient tapped "Leave Call") is a calm,
                  informational state — distinct from a genuine network drop,
                  which still shows the normal "Reconnecting…" copy. */}
              {displayStatus === 'reconnecting' && state.patientHasLeft ? 'Patient has left the consultation' : STATUS_LABEL[displayStatus]}
            </p>
          </div>

          <div className="relative mb-6">
            {displayStatus === 'connected' && (
              <>
                <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" style={{ transform: 'scale(1.3)' }} />
                <div className="absolute inset-0 rounded-full bg-white/5 animate-ping" style={{ transform: 'scale(1.6)', animationDelay: '0.4s' }} />
              </>
            )}
            <div className="relative w-36 h-36 rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white font-black text-5xl shadow-lg overflow-hidden">
              {patientPhotoUrl ? (
                <img src={patientPhotoUrl} alt={patientName} className="w-full h-full object-cover" />
              ) : (
                patientName.charAt(0)
              )}
            </div>
          </div>

          <h1 className="font-montserrat font-black text-2xl text-white mb-1">{patientName}</h1>
          <p className="text-white/50 text-sm mb-2">Patient</p>
          <p className="font-mono text-white/70 text-xl mb-8">
            {displayStatus === 'connected' ? formatCallDuration(elapsed) : '--:--'}
          </p>

          <div className="flex items-center gap-1 h-8">
            {[4, 8, 6, 14, 10, 6, 12, 8, 5, 10, 7, 4].map((h, i) => (
              <div key={i} className="w-1 rounded-full bg-teal-green/70 transition-all duration-300"
                style={{ height: muted || displayStatus !== 'connected' ? 3 : h, opacity: displayStatus === 'connected' ? 0.7 : 0.2 }} />
            ))}
          </div>

          {displayStatus === 'error' && (
            <div className="mt-4 flex flex-col items-center gap-3 max-w-xs text-center">
              <p className="text-danger/70 text-xs whitespace-pre-line">
                {errorMessage || 'Unable to connect. Check microphone permissions and try again.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setErrorMessage(''); setRetryKey(k => k + 1) }}
                  className="text-white text-xs border border-white/30 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    // A call that already started (both sides connected at
                    // some point) still needs a summary even if it's now
                    // erroring out — only a never-connected outgoing call can
                    // be silently abandoned.
                    if (state.startedAtIso) {
                      setShowEndSheet(true)
                    } else {
                      micTrackRef.current?.close()
                      leaveAgora()
                      router.replace('/doctor/consultations')
                    }
                  }}
                  className="text-white/70 text-xs border border-white/20 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors"
                >
                  {state.startedAtIso ? 'End Consultation' : 'Leave Consultation'}
                </button>
              </div>
            </div>
          )}

          {remoteMuted && displayStatus === 'connected' && (
            <div className="mt-3 flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
              <svg className="w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <span className="text-white/40 text-xs">Patient is muted</span>
            </div>
          )}

          {isReconnecting && (
            state.patientHasLeft ? (
              <div className="mt-4 flex flex-col items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 max-w-xs">
                <div className="text-white/70 text-sm font-semibold">Patient has left the consultation</div>
                <p className="text-white/40 text-xs">They can rejoin at any time — this call will remain open.</p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-center gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-2xl px-5 py-4 max-w-xs">
                <div className="flex items-center gap-2 text-yellow-300 text-sm font-semibold">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Reconnecting…
                </div>
                <p className="text-yellow-300/60 text-xs">Attempting to restore connection…</p>
              </div>
            )
          )}
        </div>

        {/* Controls */}
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between">
            <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-care-blue' : 'bg-white/10 hover:bg-white/20'}`}>
              {muted ? (
                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>

            <button
              onClick={() => {
                if (canEndWithSummary) {
                  setShowEndSheet(true)
                } else if (displayStatus === 'connecting' || displayStatus === 'error') {
                  if (confirm('Cancel this outgoing call?')) {
                    micTrackRef.current?.close()
                    leaveAgora()
                    router.replace('/doctor/consultations')
                  }
                }
              }}
              aria-label="End" title="End"
              className="w-24 h-24 rounded-full bg-danger flex items-center justify-center text-white hover:bg-danger/80 transition-colors disabled:opacity-40"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
              <svg className="w-9 h-9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" transform="rotate(135 12 12)"/>
              </svg>
            </button>

            <div className="relative">
              <button onClick={chatOpen ? () => setChatOpen(false) : openChat} aria-label={chatOpen ? 'Close chat' : 'Chat'} title={chatOpen ? 'Close chat' : 'Chat'}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/10 hover:bg-white/20'}`}>
                <MessageCircle className="w-6 h-6 text-white" />
              </button>
              {chatUnreadCount > 0 && !chatOpen && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#070E27]">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </div>

            <button onClick={() => setShowInfoPanel(true)} aria-label="Info" title="Info"
              className="w-16 h-16 rounded-full flex items-center justify-center transition-all bg-white/10 hover:bg-white/20">
              <Info className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Chat panel — identical ConsultationChatThread used by the standalone
          chat page. Always mounted from page load (visibility toggled via
          CSS, never unmounted) so the Stream channel is watched and its
          message.new listener is live immediately — otherwise the very first
          message from the peer would arrive before any subscription exists
          and the unread badge would miss it. Scroll position and the
          subscription also survive closing/reopening during the call. */}
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

      <ConsultationInfoPanel
        open={showInfoPanel}
        onClose={() => setShowInfoPanel(false)}
        consultationId={id as string}
        consultationType="phone"
        counterpartLabel="Patient"
        counterpartName={patientName}
        counterpartPhotoUrl={patientPhotoUrl}
        startedAt={state.startedAtIso}
        elapsedSeconds={elapsed}
        networkQuality={networkQuality}
      />
    </div>
  )
}
