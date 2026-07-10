'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
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

const NOTIF_BANNER_DISMISSED_KEY = 'carehub_notif_banner_dismissed'

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

  const [request,      setRequest]      = useState<IncomingRequest | null>(null)
  const [queueCount,   setQueueCount]   = useState(0)
  const [doctorStatus, setDoctorStatus] = useState<string>('')
  const [waitingLabel, setWaitingLabel] = useState('')
  const [showPermBanner, setShowPermBanner] = useState(false)
  const [showDeclineReasons, setShowDeclineReasons] = useState(false)

  const profileIdRef      = useRef<string | null>(null)
  const doctorUserRowIdRef = useRef<string | null>(null)
  const doctorPhotoUrlRef = useRef<string | null>(null)
  const activeIdRef       = useRef<string | null>(null)   // id currently shown in modal
  const lastNotifiedRef   = useRef<string | null>(null)   // id for which sound/notif fired
  const ringIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const respondingRef     = useRef(false)   // guards a double Accept/Decline click

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
        return
      }

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

      setRequest(req)

      // Sound + browser notification — only once per new request; then keep
      // ringing like an incoming call until the doctor acts or it times out.
      if (lastNotifiedRef.current !== first.id) {
        lastNotifiedRef.current = first.id
        stopRinging()
        playNotificationSound()
        showBrowserNotification(
          'Incoming Consultation Request',
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
      channel = supabase
        .channel(`incoming-overlay-${profile.id}`)
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

  // ── Accept ───────────────────────────────────────────────────────────────────
  function handleAccept(req: IncomingRequest) {
    if (respondingRef.current) return
    respondingRef.current = true
    stopRinging()
    // Navigate immediately — no waiting on Stream or DB
    activeIdRef.current = null
    setRequest(null)
    router.replace(`/doctor/consultation/${req.type}/${req.id}`)

    // Background: create Stream channel + update DB status concurrently —
    // the call screens lazily create/join the channel via watch({members})
    // if it isn't ready yet, so the status write (which the patient's
    // Realtime-triggered navigation depends on) no longer has to wait on
    // the Stream API round-trip.
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return

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

        const statusUpdate = getAuthClient(token)
          .from('consultations')
          .update({ status: 'accepted', started_at: new Date().toISOString() })
          .eq('id', req.id)

        await Promise.allSettled([channelCreate, statusUpdate])
      } catch {}
    })()
  }

  // ── Decline ──────────────────────────────────────────────────────────────────
  async function handleDecline(id: string, reason: string) {
    if (respondingRef.current) return
    respondingRef.current = true
    stopRinging()
    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({
          status: 'declined',
          decline_reason: reason,
          declined_by: doctorUserRowIdRef.current,
          declined_at: new Date().toISOString(),
        })
        .eq('id', id)
    }
    activeIdRef.current = null
    setRequest(null)
    setShowDeclineReasons(false)
    respondingRef.current = false
    // Next poll cycle (≤5 s) will surface the next waiting patient if any
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

  // ── Busy badge — doctor is in a session but patients are queued ──────────────
  if (!request && queueCount > 0) {
    return (
      <>
        {permBanner}
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-warning/10 border border-warning/30 text-warning rounded-2xl px-4 py-2.5 text-sm font-montserrat font-semibold shadow-lg pointer-events-none">
          <Clock size={15} />
          {queueCount} patient{queueCount > 1 ? 's' : ''} waiting
        </div>
      </>
    )
  }

  if (!request) return permBanner ?? null

  const meta = TYPE_META[request.type] ?? TYPE_META.chat
  const TypeIcon = meta.icon

  return (
    <>
      {permBanner}
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

          {/* Queue hint */}
          {queueCount > 1 && (
            <p className="text-ink-black/40 text-xs mb-4">
              +{queueCount - 1} more patient{queueCount - 1 > 1 ? 's' : ''} in queue
            </p>
          )}

          {/* Actions */}
          {!showDeclineReasons ? (
            <ConsultationActionButtons
              onDecline={() => setShowDeclineReasons(true)}
              onAccept={() => handleAccept(request)}
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
