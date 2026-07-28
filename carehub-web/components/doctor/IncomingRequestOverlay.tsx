'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, CheckCircle2, ChevronRight, CreditCard, Clock, MessageCircle, Phone, User, Video, X } from 'lucide-react'
import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { getAuthClient, supabase } from '@/lib/supabase'
import { fetchStreamToken, getStreamClient } from '@/lib/stream'

const DECLINE_REASONS = ['Currently busy', 'Wrong specialty', 'Technical issue', 'Other']

interface IncomingRequest {
  id: string
  type: string
  patientName: string
  patientClerkId: string
  patientPhotoUrl: string | null
  amount: number
  waitingStartedAt: string
}

const TYPE_META: Record<string, { icon: typeof MessageCircle; label: string; color: string; bg: string }> = {
  chat:  { icon: MessageCircle, label: 'Chat Consultation',  color: '#00BFA5', bg: 'rgba(0,191,165,0.12)' },
  phone: { icon: Phone,         label: 'Phone Consultation', color: '#1A4598', bg: 'rgba(26,69,152,0.12)' },
  video: { icon: Video,         label: 'Video Consultation', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
}

const NOTIF_BANNER_DISMISSED_KEY = 'dawa_notif_banner_dismissed'

// Notification title wording — never call every consultation a "call".
const NOTIF_TYPE_TITLE: Record<string, string> = {
  chat:  'Chat',
  phone: 'Voice Consultation',
  video: 'Video Consultation',
}

function formatWaiting(waitingStartedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(waitingStartedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// Three ascending tones — audible on both desktop speakers and laptop speakers.
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    ;[0, 0.18, 0.36].forEach((offset, i) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = [440, 554, 660][i]
      const t = ctx.currentTime + offset
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.28, t + 0.025)
      gain.gain.linearRampToValueAtTime(0, t + 0.14)
      osc.start(t)
      osc.stop(t + 0.15)
    })
  } catch {}
}

function showBrowserNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico' })
    n.onclick = () => { window.focus(); n.close() }
  } catch {}
}

export default function IncomingRequestOverlay() {
  const { user }      = useUser()
  const { getToken }  = useAuth()
  const router        = useRouter()
  const pathname      = usePathname()
  // Never show the queue badge, Accept/Decline modal, or any banner on top of
  // an active consultation screen — matches DoctorConsultationRecovery's own
  // exemption for this route prefix.
  const onConsultationScreen = pathname?.startsWith('/doctor/consultation/') ?? false

  const [request,      setRequest]      = useState<IncomingRequest | null>(null)
  const [queueCount,   setQueueCount]   = useState(0)
  const [queueList,    setQueueList]    = useState<{ id: string; patientName: string; waitingStartedAt: string }[]>([])
  const [doctorStatus, setDoctorStatus] = useState<string>('')
  const [waitingLabel, setWaitingLabel] = useState('')
  const [showPermBanner, setShowPermBanner] = useState(false)
  const [showDeclineReasons, setShowDeclineReasons] = useState(false)
  // Surfaced only if the background 'accepted' write never lands after
  // retrying — otherwise the doctor is left staring at "Connecting…" while
  // the patient is stuck on "Waiting for Doctor" with nothing telling either
  // of them anything went wrong.
  const [acceptFailure, setAcceptFailure] = useState<IncomingRequest | null>(null)
  // DOCTOR_BUSY is a business-rule rejection (already in another consultation),
  // not a transient failure — shown as its own non-retryable banner instead of
  // the generic "couldn't confirm, retry" one below.
  const [acceptBusy, setAcceptBusy] = useState(false)
  // Surfaced only if the background 'declined' write never lands after
  // retrying — otherwise the modal dismisses cleanly while the patient stays
  // stuck on "Waiting for Doctor" forever.
  const [declineFailure, setDeclineFailure] = useState<{ id: string; reason: string; patientName: string } | null>(null)

  const profileIdRef      = useRef<string | null>(null)
  const doctorUserRowIdRef = useRef<string | null>(null)
  const doctorPhotoUrlRef = useRef<string | null>(null)
  const activeIdRef       = useRef<string | null>(null)   // id currently shown in modal
  const lastNotifiedRef   = useRef<string | null>(null)   // id for which sound/notif fired
  const ringIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const respondingRef     = useRef(false)   // guards a double Accept/Decline click
  // Drives ConsultationActionButtons' disabled prop — respondingRef alone
  // guards re-entrant handling, but a ref update doesn't re-render, so
  // without this the buttons stay visually clickable for a frame after click.
  const [responding, setResponding] = useState(false)

  const stopRinging = useCallback(() => {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null }
    if (ringTimeoutRef.current)  { clearTimeout(ringTimeoutRef.current);  ringTimeoutRef.current = null }
  }, [])

  // ── Core check: query DB for waiting patients ────────────────────────────────
  const checkForWaiting = useCallback(async (profileId: string, token: string) => {
    try {
      const client = getAuthClient(token)

      // Only treat a consultation as "busy" if it was started within the last 4 hours.
      // This prevents zombie sessions (doctor closed tab without ending) from permanently
      // blocking the Accept modal.
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

      const [{ data: busy }, { data: waiting }] = await Promise.all([
        client
          .from('consultations')
          .select('id')
          .eq('doctor_id', profileId)
          .in('status', ['accepted', 'in_progress', 'active'])
          .gte('started_at', fourHoursAgo)
          .limit(1),
        client
          .from('consultations')
          .select('id, type, patient_id, patient_amount, waiting_started_at')
          .eq('doctor_id', profileId)
          .eq('status', 'waiting_for_doctor')
          .eq('payment_status', 'paid')
          .order('waiting_started_at', { ascending: true }),
      ])

      const count = waiting?.length ?? 0
      setQueueCount(count)

      if (count === 0) {
        // No one waiting — clear if we were showing something
        activeIdRef.current = null
        lastNotifiedRef.current = null
        stopRinging()
        setRequest(null)
        setShowDeclineReasons(false)
        setQueueList([])
        return
      }

      // Ordered queue for display (names + wait time) — separate from the
      // richer single-patient fetch below (which also needs photo/clerk id
      // for the Accept modal), so a name-only batch covers every waiting
      // patient without re-fetching for the one becoming `request`.
      const { data: queuePatients } = await client
        .from('users')
        .select('id, full_name')
        .in('id', waiting!.map((w) => w.patient_id))
      const nameById = new Map((queuePatients ?? []).map((p) => [p.id, p.full_name]))
      setQueueList(
        waiting!.map((w) => ({
          id: w.id,
          patientName: nameById.get(w.patient_id) ?? 'Patient',
          waitingStartedAt: w.waiting_started_at ?? new Date().toISOString(),
        }))
      )

      // Doctor is busy — show queue badge but hold off on the modal
      if (busy && busy.length > 0) return

      const first = waiting![0]

      // Already showing this request — nothing to do
      if (activeIdRef.current === first.id) return
      activeIdRef.current = first.id
      setShowDeclineReasons(false)

      const { data: pat } = await client
        .from('users')
        .select('full_name, clerk_id, profile_photo_url')
        .eq('id', first.patient_id)
        .single()

      const req: IncomingRequest = {
        id:              first.id,
        type:            first.type,
        patientName:     pat?.full_name  ?? 'Patient',
        patientClerkId:  pat?.clerk_id   ?? '',
        patientPhotoUrl: pat?.profile_photo_url ?? null,
        amount:          first.patient_amount ?? 0,
        waitingStartedAt: first.waiting_started_at ?? new Date().toISOString(),
      }

      setResponding(false)
      setRequest(req)

      // Sound + browser notification — only once per new request; then keep
      // ringing like an incoming call until the doctor acts or it times out.
      if (lastNotifiedRef.current !== first.id) {
        lastNotifiedRef.current = first.id
        stopRinging()
        playNotificationSound()
        showBrowserNotification(
          `${NOTIF_TYPE_TITLE[req.type] ?? 'Consultation'} with ${req.patientName}`,
          `${req.patientName} wants a ${req.type} consultation`,
        )
        ringIntervalRef.current = setInterval(playNotificationSound, 3000)
        ringTimeoutRef.current = setTimeout(stopRinging, 45_000)
      }
    } catch {
      // Network hiccup — next poll will retry
    }
  }, [stopRinging])

  // ── Lifecycle: init once per signed-in user ──────────────────────────────────
  useEffect(() => {
    if (!user) return

    let mounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let poll:    ReturnType<typeof setInterval>    | null = null

    async function init() {
      const token = await getToken()
      if (!token || !mounted) return

      const client = getAuthClient(token)

      const { data: userData } = await client
        .from('users')
        .select('id, profile_photo_url')
        .eq('clerk_id', user!.id)
        .single()
      if (!userData || !mounted) return
      doctorUserRowIdRef.current = userData.id
      doctorPhotoUrlRef.current = (userData as any).profile_photo_url ?? null

      const { data: profile } = await client
        .from('doctor_profiles')
        .select('id, status')
        .eq('user_id', userData.id)
        .single()
      if (!profile || !mounted) return

      profileIdRef.current = profile.id
      setDoctorStatus(profile.status)

      // Show a one-time explanatory banner instead of silently prompting —
      // browsers throttle/ignore permission requests not triggered by a click.
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default' &&
        typeof localStorage !== 'undefined' &&
        !localStorage.getItem(NOTIF_BANNER_DISMISSED_KEY)
      ) {
        setShowPermBanner(true)
      }

      // Initial check — catches any consultation already waiting
      await checkForWaiting(profile.id, token)

      // Realtime subscription — fires immediately when consultation row changes
      // (requires consultations to be in the supabase_realtime publication — migration 022)
      // Guards against a stale same-topic channel left behind by a fast-
      // refresh/remount (React StrictMode, auth-state transition) — without
      // this, supabase-js's per-topic cache can throw "cannot add
      // postgres_changes callbacks after subscribe()" on the leftover, or
      // worse, leave two live subscriptions both calling checkForWaiting for
      // the same doctor. Mirrors the mobile equivalents in
      // app/(doctor)/(tabs)/home.tsx and app/(doctor)/incoming-request.tsx.
      const overlayTopic = `incoming-overlay-${profile.id}`
      const staleOverlayChannel = supabase.getChannels().find((c) => c.topic === `realtime:${overlayTopic}`)
      if (staleOverlayChannel) supabase.removeChannel(staleOverlayChannel)
      channel = supabase
        .channel(overlayTopic)
        .on('postgres_changes', {
          event:  '*',
          schema: 'public',
          table:  'consultations',
          filter: `doctor_id=eq.${profile.id}`,
        }, async () => {
          const t = await getToken()
          if (t && profileIdRef.current && mounted) {
            await checkForWaiting(profileIdRef.current, t)
          }
        })
        .subscribe()

      // 5-second polling fallback — compensates for any Realtime gaps
      poll = setInterval(async () => {
        const t = await getToken()
        if (t && profileIdRef.current && mounted) {
          await checkForWaiting(profileIdRef.current, t)
        }
      }, 5_000)
    }

    init()

    // Re-check when the tab regains focus (doctor was in another tab)
    const onVisibility = async () => {
      if (document.visibilityState === 'visible' && profileIdRef.current) {
        const t = await getToken()
        if (t) await checkForWaiting(profileIdRef.current, t)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted = false
      if (channel) supabase.removeChannel(channel)
      if (poll)    clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
      stopRinging()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Live "time waiting" ticker for the modal
  useEffect(() => {
    if (!request) { setWaitingLabel(''); return }
    setWaitingLabel(formatWaiting(request.waitingStartedAt))
    const id = setInterval(() => setWaitingLabel(formatWaiting(request.waitingStartedAt)), 1000)
    return () => clearInterval(id)
  }, [request])

  function handleEnableNotifications() {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NOTIF_BANNER_DISMISSED_KEY, '1')
    setShowPermBanner(false)
    if (typeof Notification !== 'undefined') Notification.requestPermission().catch(() => {})
  }

  function handleDismissBanner() {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NOTIF_BANNER_DISMISSED_KEY, '1')
    setShowPermBanner(false)
  }

  // Writes status:'accepted', retrying a couple of times on failure —
  // without this, a transient network blip or a rejected write (e.g. a
  // trigger exception) silently strands the patient on "Waiting for Doctor"
  // forever with the doctor already sitting on the call screen unaware
  // anything went wrong. Treats "0 rows matched" as success if some other
  // path (a race with another device/tab) already moved the row past
  // 'waiting_for_doctor'.
  const writeAccepted = useCallback(async (token: string, consultationId: string): Promise<'ok' | 'busy' | 'failed'> => {
    const client = getAuthClient(token)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await client
        .from('consultations')
        .update({ status: 'accepted', started_at: new Date().toISOString() })
        .eq('id', consultationId)
        .eq('status', 'waiting_for_doctor')
        .select('id')
      if (!error && data && data.length > 0) return 'ok'
      if (!error) {
        const { data: row } = await client.from('consultations').select('status').eq('id', consultationId).single()
        if (row?.status === 'accepted' || row?.status === 'in_progress') return 'ok'
      }
      // DOCTOR_BUSY means the doctor already has another accepted/in_progress
      // consultation — a business-rule rejection, not a transient failure, so
      // retrying won't help; bail out immediately.
      if (error?.message?.includes('DOCTOR_BUSY')) return 'busy'
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500))
    }
    return 'failed'
  }, [])

  // ── Accept ───────────────────────────────────────────────────────────────────
  // Navigates the instant the doctor taps Accept — the consultation screen's
  // own "Connecting…" state covers the network round trip, so the doctor is
  // never left staring at Home. activeIdRef stays pinned to req.id (cleared
  // only once writeAccepted/channelCreate finish) so checkForWaiting's own
  // dedupe ("already showing this request") suppresses the modal popping
  // back up while the background write is still in flight — this is what an
  // earlier "optimistic" version was missing when it caused that regression.
  function handleAccept(req: IncomingRequest) {
    if (respondingRef.current) return
    respondingRef.current = true
    setResponding(true)
    setAcceptFailure(null)

    stopRinging()
    setRequest(null)
    respondingRef.current = false
    router.replace(`/doctor/consultation/${req.type}/${req.id}`)

    ;(async () => {
      try {
        const token = await getToken()
        if (!token) { activeIdRef.current = null; setAcceptFailure(req); return }

        // Create/upsert the Stream channel with both members regardless of
        // consultation type — phone and video consultations use the same
        // ConsultationChatThread drawer and need the channel membership set
        // up here too, not just for standalone chat consultations.
        const channelCreate = (async () => {
          if (!user || !req.patientClerkId) return
          try {
            await Promise.race([
              (async () => {
                const streamToken = await fetchStreamToken(token)
                const streamCli   = getStreamClient()
                if (!streamCli.userID) {
                  await streamCli.connectUser(
                    {
                      id: user.id,
                      name: user.fullName ?? user.firstName ?? 'Doctor',
                      image: doctorPhotoUrlRef.current ?? user.imageUrl ?? undefined,
                    },
                    streamToken,
                  )
                }
                const ch = streamCli.channel('messaging', req.id, { members: [user.id, req.patientClerkId] })
                await ch.create()
              })(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('stream channel create timeout')), 5000)),
            ])
          } catch {
            // channel might already exist, or timed out — safe either way
          }
        })()

        const [, result] = await Promise.all([channelCreate, writeAccepted(token, req.id)])

        if (result === 'ok') {
          activeIdRef.current = null
        } else if (result === 'busy') {
          activeIdRef.current = null
          setAcceptBusy(true)
        } else {
          // Failed — surfaces a retry banner (rendered even on the
          // consultation screen the doctor already navigated into, since
          // this overlay is mounted at the layout level) instead of leaving
          // the patient stranded on "Waiting for Doctor".
          setAcceptFailure(req)
        }
      } catch {
        setAcceptFailure(req)
      }
    })()
  }

  function retryAccept() {
    if (!acceptFailure) return
    const req = acceptFailure
    setAcceptFailure(null)
    respondingRef.current = true
    ;(async () => {
      const token = await getToken()
      if (!token) { respondingRef.current = false; setAcceptFailure(req); return }
      const result = await writeAccepted(token, req.id)
      if (result === 'ok') {
        stopRinging()
        activeIdRef.current = null
        setRequest(null)
        respondingRef.current = false
        router.replace(`/doctor/consultation/${req.type}/${req.id}`)
      } else if (result === 'busy') {
        stopRinging()
        activeIdRef.current = null
        setRequest(null)
        respondingRef.current = false
        setAcceptBusy(true)
      } else {
        respondingRef.current = false
        setAcceptFailure(req)
      }
    })()
  }

  // Writes status:'declined', retrying a couple of times on failure — mirrors
  // writeAccepted above. Treats "0 rows matched" as success if some other
  // path (patient cancelled, another device already responded) already moved
  // the row past 'waiting_for_doctor'.
  const writeDeclined = useCallback(async (token: string, id: string, reason: string): Promise<'ok' | 'failed'> => {
    const client = getAuthClient(token)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await client
        .from('consultations')
        .update({
          status: 'declined',
          decline_reason: reason,
          declined_by: doctorUserRowIdRef.current,
          declined_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'waiting_for_doctor')
        .select('id')
      if (!error && data && data.length > 0) return 'ok'
      if (!error) {
        const { data: row } = await client.from('consultations').select('status').eq('id', id).single()
        if (row?.status !== 'waiting_for_doctor') return 'ok'
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500))
    }
    return 'failed'
  }, [])

  // ── Decline ──────────────────────────────────────────────────────────────────
  async function handleDecline(id: string, reason: string) {
    if (respondingRef.current) return
    respondingRef.current = true
    setResponding(true)
    stopRinging()
    const patientName = request?.patientName ?? 'the patient'
    activeIdRef.current = null
    setRequest(null)
    setShowDeclineReasons(false)
    respondingRef.current = false
    // Next poll cycle (≤5 s) will surface the next waiting patient if any

    const token = await getToken()
    if (!token) { setDeclineFailure({ id, reason, patientName }); return }
    const result = await writeDeclined(token, id, reason)
    if (result !== 'ok') setDeclineFailure({ id, reason, patientName })
  }

  function retryDecline() {
    if (!declineFailure) return
    const { id, reason, patientName } = declineFailure
    setDeclineFailure(null)
    ;(async () => {
      const token = await getToken()
      if (!token) { setDeclineFailure({ id, reason, patientName }); return }
      const result = await writeDeclined(token, id, reason)
      if (result !== 'ok') setDeclineFailure({ id, reason, patientName })
    })()
  }

  // Unapproved doctors never see the overlay
  if (doctorStatus && doctorStatus !== 'approved') {
    return null
  }

  const permBanner = showPermBanner && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-ink-black text-mist-white rounded-2xl pl-4 pr-2 py-2.5 text-sm shadow-xl max-w-md w-[calc(100%-2rem)]">
      <Bell size={16} className="shrink-0 text-teal-green" />
      <span className="flex-1">Enable browser notifications so you never miss a patient request.</span>
      <button
        onClick={handleEnableNotifications}
        className="shrink-0 bg-teal-green text-ink-black font-semibold rounded-full px-3 py-1.5 text-xs hover:opacity-90"
      >
        Enable
      </button>
      <button
        onClick={handleDismissBanner}
        aria-label="Dismiss"
        className="shrink-0 text-mist-white/50 hover:text-mist-white"
      >
        <X size={16} />
      </button>
    </div>
  )

  const acceptFailureBanner = acceptFailure && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-danger text-mist-white rounded-2xl pl-4 pr-2 py-2.5 text-sm shadow-xl max-w-md w-[calc(100%-2rem)]">
      <span className="flex-1">
        Couldn&apos;t confirm the {acceptFailure.patientName} consultation — they may still be waiting.
      </span>
      <button
        onClick={retryAccept}
        className="shrink-0 bg-mist-white text-danger font-semibold rounded-full px-3 py-1.5 text-xs hover:opacity-90"
      >
        Retry
      </button>
      <button
        onClick={() => setAcceptFailure(null)}
        aria-label="Dismiss"
        className="shrink-0 text-mist-white/70 hover:text-mist-white"
      >
        <X size={16} />
      </button>
    </div>
  )

  const acceptBusyBanner = acceptBusy && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-warning text-ink-black rounded-2xl pl-4 pr-2 py-2.5 text-sm shadow-xl max-w-md w-[calc(100%-2rem)]">
      <span className="flex-1 font-semibold">
        You&apos;re already in another consultation. This request is still waiting — accept it once you&apos;re free.
      </span>
      <button
        onClick={() => setAcceptBusy(false)}
        aria-label="Dismiss"
        className="shrink-0 text-ink-black/70 hover:text-ink-black"
      >
        <X size={16} />
      </button>
    </div>
  )

  const declineFailureBanner = declineFailure && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-danger text-mist-white rounded-2xl pl-4 pr-2 py-2.5 text-sm shadow-xl max-w-md w-[calc(100%-2rem)]">
      <span className="flex-1">
        Couldn&apos;t confirm declining the request from {declineFailure.patientName}.
      </span>
      <button
        onClick={retryDecline}
        className="shrink-0 bg-mist-white text-danger font-semibold rounded-full px-3 py-1.5 text-xs hover:opacity-90"
      >
        Retry
      </button>
      <button
        onClick={() => setDeclineFailure(null)}
        aria-label="Dismiss"
        className="shrink-0 text-mist-white/70 hover:text-mist-white"
      >
        <X size={16} />
      </button>
    </div>
  )

  // ── Busy badge — doctor is in a session but patients are queued ──────────────
  // Never show the queue badge or the Accept/Decline modal on top of an
  // active consultation screen — the failure/busy banners above stay visible
  // since they're an actionable result of the doctor's own action, not a
  // ghost "waiting" panel.
  if (!request && queueCount > 0 && !onConsultationScreen) {
    return (
      <>
        {permBanner}
        {acceptFailureBanner}
        {acceptBusyBanner}
        {declineFailureBanner}
        <div className="fixed top-4 right-4 z-50 bg-white border border-warning/30 rounded-2xl shadow-lg pointer-events-none max-w-xs w-full overflow-hidden">
          <div className="flex items-center gap-2 bg-warning/10 text-warning px-4 py-2.5 text-sm font-montserrat font-semibold">
            <Clock size={15} />
            {queueCount} patient{queueCount > 1 ? 's' : ''} waiting
          </div>
          {queueList.length > 0 && (
            <ul className="divide-y divide-ink-black/[0.06] text-left">
              {queueList.map((q, i) => (
                <li key={q.id} className="flex items-center gap-2.5 px-4 py-2 text-xs">
                  <span className="text-ink-black/35 font-semibold w-4 shrink-0">{i + 1}.</span>
                  <span className="flex-1 font-semibold text-ink-black truncate">{q.patientName}</span>
                  <span className="text-ink-black/40 shrink-0">{formatWaiting(q.waitingStartedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    )
  }

  if (!request || onConsultationScreen) return <>{permBanner}{acceptFailureBanner}{acceptBusyBanner}{declineFailureBanner}</>

  const meta = TYPE_META[request.type] ?? TYPE_META.chat
  const TypeIcon = meta.icon

  return (
    <>
      {permBanner}
      {acceptFailureBanner}
      {acceptBusyBanner}
      {declineFailureBanner}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="card p-8 max-w-sm w-full text-center">
          {/* Type badge */}
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold mb-4"
            style={{ backgroundColor: meta.bg, color: meta.color }}
          >
            <TypeIcon size={14} />
            {meta.label}
          </div>

          {/* Avatar */}
          <div className="w-24 h-24 rounded-full mx-auto mb-3 border-[3px] border-teal-green shadow-lg shadow-teal-green/30 overflow-hidden bg-gradient-interactive flex items-center justify-center">
            {request.patientPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={request.patientPhotoUrl} alt={request.patientName} className="w-full h-full object-cover" />
            ) : (
              <User size={40} className="text-white/70" />
            )}
          </div>

          <p className="text-[11px] font-semibold tracking-widest uppercase text-ink-black/40 mb-1">
            Incoming Request
          </p>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-4">
            {request.patientName}
          </h2>

          <div className="inline-flex items-center gap-1.5 bg-success/10 text-success border border-success/30 rounded-full px-3 py-1 text-xs font-semibold mb-4">
            <CheckCircle2 size={14} /> Payment Confirmed
          </div>

          {/* Info card */}
          <div className="rounded-2xl border border-ink-black/10 bg-ink-black/[0.03] divide-y divide-ink-black/[0.07] text-left mb-4">
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <User size={14} className="text-ink-black/40 shrink-0" />
              <span className="flex-1 text-xs text-ink-black/50">Patient</span>
              <span className="text-xs font-semibold text-ink-black">{request.patientName}</span>
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <TypeIcon size={14} className="shrink-0" style={{ color: meta.color }} />
              <span className="flex-1 text-xs text-ink-black/50">Type</span>
              <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <Clock size={14} className="text-ink-black/40 shrink-0" />
              <span className="flex-1 text-xs text-ink-black/50">Waiting</span>
              <span className="text-xs font-semibold text-ink-black">{waitingLabel}</span>
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <CreditCard size={14} className="text-success shrink-0" />
              <span className="flex-1 text-xs text-ink-black/50">Payment</span>
              <span className="text-xs font-semibold text-success">ETB {request.amount} paid</span>
            </div>
          </div>

          {/* Queue hint — queueList[0] is the patient shown above as `request`,
              so the rest of the list is who's waiting behind them. */}
          {queueList.length > 1 && (
            <div className="text-left mb-4">
              <p className="text-ink-black/40 text-[11px] font-semibold uppercase tracking-wide mb-1.5">
                Next in queue
              </p>
              <ul className="rounded-xl border border-ink-black/10 divide-y divide-ink-black/[0.06]">
                {queueList.slice(1, 4).map((q, i) => (
                  <li key={q.id} className="flex items-center gap-2.5 px-3 py-1.5 text-xs">
                    <span className="text-ink-black/35 font-semibold w-3.5 shrink-0">{i + 1}.</span>
                    <span className="flex-1 font-semibold text-ink-black truncate">{q.patientName}</span>
                    <span className="text-ink-black/40 shrink-0">{formatWaiting(q.waitingStartedAt)}</span>
                  </li>
                ))}
              </ul>
              {queueList.length > 4 && (
                <p className="text-ink-black/40 text-xs mt-1.5">
                  +{queueList.length - 4} more waiting
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          {!showDeclineReasons ? (
            <ConsultationActionButtons
              onDecline={() => setShowDeclineReasons(true)}
              onAccept={() => handleAccept(request)}
              disabled={responding}
            />
          ) : (
            <div className="text-left">
              <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Why are you declining?</p>
              <div className="rounded-2xl border border-ink-black/10 divide-y divide-ink-black/[0.07] overflow-hidden">
                {DECLINE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    onClick={() => handleDecline(request.id, reason)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-ink-black hover:bg-ink-black/[0.03] transition-colors"
                  >
                    {reason}
                    <ChevronRight size={16} className="text-ink-black/30" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowDeclineReasons(false)}
                className="mt-3 w-full text-center text-xs font-semibold text-ink-black/50 hover:text-ink-black/70 py-2"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
