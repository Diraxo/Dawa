'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorOnlineStatus } from '@/hooks/useDoctorOnlineStatus'
import { useServerNow } from '@/lib/serverClock'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'
import VerifiedBadge from '@/components/ui/VerifiedBadge'
import { MessageCircle, Phone, Video, Zap, Calendar, Wallet, Check } from 'lucide-react'
import {
  DAY_NAMES,
  SLOT_DURATION_MINS,
  isSlotPast,
  getAvailableSlots,
  getNextDays,
  parseScheduledAt,
} from '@/lib/slotGeneration'

interface DoctorProfile {
  id: string
  specialty: string
  chat_price: number
  phone_price: number
  video_price: number
  hospital_name: string
  is_online: boolean
  availability: Record<string, unknown> | null
  status: string
  user: { full_name: string } | null
}

type ConsultType = 'chat' | 'phone' | 'video'
type Step = 1 | 2 | 3 | 4

interface ActiveCredit {
  creditConsultationId: string
  creditAmount:         number
  type:                 ConsultType
}

const TYPE_META: Record<ConsultType, { icon: typeof MessageCircle; label: string; priceKey: keyof DoctorProfile }> = {
  chat:  { icon: MessageCircle, label: 'Chat Consultation',  priceKey: 'chat_price' },
  phone: { icon: Phone,         label: 'Phone Call',          priceKey: 'phone_price' },
  video: { icon: Video,         label: 'Video Call',          priceKey: 'video_price' },
}

// Bounds any promise that has no built-in timeout (Clerk's getToken(), plain
// supabase-js calls without an abortSignal) — without this, a stalled request
// left the booking button stuck on its loading state forever with no error
// and no way to recover.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

export default function BookingPage() {
  const { doctorId } = useParams<{ doctorId: string }>()
  const searchParams = useSearchParams()
  const { getToken } = useAuth()
  const { user } = useUser()

  const initialType = (searchParams.get('type') ?? 'chat') as ConsultType
  // Lets a caller (e.g. the waiting-room page, after a cancelled/declined
  // consultation) land directly on the date/time step instead of making the
  // patient re-pick a consultation type they already chose once.
  const requestedStep = Number(searchParams.get('step'))
  const initialStep = (requestedStep === 2 || requestedStep === 3 || requestedStep === 4 ? requestedStep : 1) as Step
  const [step, setStep] = useState<Step>(initialStep)
  const [doctor, setDoctor] = useState<DoctorProfile | null>(null)
  const [selectedType, setSelectedType] = useState<ConsultType>(initialType)
  // Starts unset (not a hardcoded 'now' literal) so the very first render of
  // the timing step can never show the wrong option selected — see
  // `effectiveScheduleMode` below, which derives the real default from
  // canStartNow until the patient makes an explicit choice.
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule' | null>(null)
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [activeCredit, setActiveCredit] = useState<ActiveCredit | null>(null)
  const [creditLoading, setCreditLoading] = useState(false)
  const [commissionRate, setCommissionRate] = useState(20)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorScheduledSoon, setDoctorScheduledSoon] = useState(false)

  // Device-clock-independent "now", synced against Postgres' own now() —
  // see lib/serverClock.ts. Both re-syncs periodically and ticks every 30s,
  // so a slot that just became past disappears without the patient touching
  // anything, and can't be kept bookable by a wrong/rolled-back device clock.
  const nowMs = useServerNow()
  const days = getNextDays(7, undefined, nowMs)

  // Fetches the doctor profile. Called on mount, then once more when the
  // realtime channel below reaches SUBSCRIBED — reconciles an is_online /
  // availability change that fired during the join-latency window (before
  // SUBSCRIBED), which would otherwise be lost forever. Passed through
  // `reconcile` so this fetch can't revert a live update that already
  // applied while it was in flight.
  function loadDoctor() {
    supabase
      .from('doctor_profiles')
      .select('id, specialty, hospital_name, is_online, chat_price, phone_price, video_price, availability, status, user:users(full_name)')
      .eq('id', doctorId)
      .single()
      .then(({ data }) => {
        setDoctor(data ? reconcile(data as unknown as DoctorProfile) : null)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadDoctor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId])

  useEffect(() => {
    supabase.rpc('get_commission_rate').then(({ data }) => {
      if (typeof data === 'number') setCommissionRate(data)
    })
  }, [])

  // Realtime: doctor online/offline status + availability → "Start Now" gate
  // and slot list update live
  const { reconcile } = useDoctorOnlineStatus((updatedId, fields) => {
    if (updatedId !== doctorId) return
    setDoctor(prev => prev ? { ...prev, is_online: fields.is_online, availability: fields.availability ?? prev.availability } : prev)
  }, () => { loadDoctor() })

  const canStartNow = Boolean(doctor?.is_online) && !doctorBusy && !doctorScheduledSoon

  // The real default before the patient makes an explicit choice — derived
  // from canStartNow on every render (not a one-time effect), so the timing
  // step never paints a hardcoded 'now' that then has to visibly flip.
  const effectiveScheduleMode: 'now' | 'schedule' = scheduleMode ?? (canStartNow ? 'now' : 'schedule')

  // Fall back to scheduling if "Start Now" stops being valid while this
  // screen is open (doctor goes offline, or becomes busy).
  useEffect(() => {
    if (effectiveScheduleMode === 'now' && !canStartNow) setScheduleMode('schedule')
  }, [canStartNow, effectiveScheduleMode])

  // Doctor is BUSY when they already have an accepted/in-progress
  // consultation. Checked via RPC (not a direct table read) so the patient
  // never needs SELECT access to another patient's consultation row just to
  // see a boolean. Polled while this screen is open.
  async function checkDoctorBusy(doctorId: string) {
    const { data } = await supabase.rpc('is_doctor_busy', { p_doctor_id: doctorId })
    return Boolean(data)
  }

  // Doctor has a scheduled consultation starting within the configurable
  // on-demand safety buffer (platform_settings.on_demand_buffer_minutes,
  // 5 min by default — see migration 083). Checked client-side so "Right
  // Now" greys out with the real reason before the patient reaches payment,
  // instead of only discovering it from a server rejection.
  async function checkDoctorScheduledSoon(doctorId: string) {
    const { data } = await supabase.rpc('is_doctor_scheduled_soon', { p_doctor_id: doctorId })
    return Boolean(data)
  }

  useEffect(() => {
    if (!doctorId) return
    let cancelled = false
    const refresh = () => {
      checkDoctorBusy(doctorId).then(busy => { if (!cancelled) setDoctorBusy(busy) })
      checkDoctorScheduledSoon(doctorId).then(soon => { if (!cancelled) setDoctorScheduledSoon(soon) })
    }
    refresh()
    const interval = setInterval(refresh, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [doctorId])

  // Which of the currently-generated slots for the selected day are already
  // booked. Read directly from slot_locks (patients can SELECT any doctor's
  // locks — see migration 019's "Patients can view all slot locks" policy),
  // mirroring RescheduleModal.tsx and mobile's BookingModal.tsx. Previously
  // this used the is_slot_available RPC, which conflates "locked" and
  // "already in the past" into a single boolean — that made a merely-past
  // (never-booked) slot render identically to a truly booked one instead of
  // falling through to the separate grey "Past" style below.
  // Re-runs whenever the selected day (or the doctor's hours) changes.
  useEffect(() => {
    if (!doctorId || !doctor) { setBookedSlots(new Set()); return }
    const dayValue = days[selectedDay]?.value
    if (!dayValue) return
    const slots = getAvailableSlots(doctor.availability ?? null, dayValue)
    if (slots.length === 0) { setBookedSlots(new Set()); return }
    const dayStart = new Date(`${dayValue}T00:00:00`)
    const dayEnd = new Date(`${dayValue}T23:59:59.999`)

    const fetchBookedSlots = () => {
      supabase
        .from('slot_locks')
        .select('slot_start')
        .eq('doctor_id', doctorId)
        .gte('slot_start', dayStart.toISOString())
        .lte('slot_start', dayEnd.toISOString())
        .gt('expires_at', new Date().toISOString())
        .then(({ data }) => {
          if (!data) { setBookedSlots(new Set()); return }
          setBookedSlots(new Set(data.map((row: any) => {
            const d = new Date(row.slot_start)
            const h = d.getHours(), m = d.getMinutes()
            const meridiem = h >= 12 ? 'PM' : 'AM'
            const h12 = h % 12 === 0 ? 12 : h % 12
            return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`
          })))
        })
    }

    fetchBookedSlots()

    // Another patient booking/cancelling the same day while this page is
    // already open must flip that slot's availability live — without this,
    // only re-selecting the day picked it up.
    const channel = supabase
      .channel(`booking-slot-locks-${doctorId}-${dayValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_locks', filter: `doctor_id=eq.${doctorId}` },
        () => fetchBookedSlots()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, selectedDay, doctor?.availability])

  // Check for active credit as soon as the page loads — not just at the
  // review step — so Step 1's type selector can be locked to the credit's
  // original consultation type from the start. A credit is only ever
  // redeemable against the SAME type it was paid for (never converted
  // chat -> video, etc.), so selectedType is force-set here too.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setCreditLoading(true)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!userData || cancelled) return

        const { data: credits } = await client
          .from('consultations')
          .select('id, credit_amount, type')
          .eq('patient_id', userData.id)
          .eq('consultation_credit', true)
          .eq('credit_used', false)
          .order('created_at', { ascending: false })
          .limit(1)

        if (cancelled) return
        if (credits && credits.length > 0) {
          const creditType = (credits[0].type ?? 'chat') as ConsultType
          setActiveCredit({
            creditConsultationId: credits[0].id,
            creditAmount:         Number(credits[0].credit_amount ?? 0),
            type:                 creditType,
          })
          setSelectedType(creditType)
        } else {
          setActiveCredit(null)
        }
      } catch {
        // credit check is best-effort
      } finally {
        if (!cancelled) setCreditLoading(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function initiateChapaPayment() {
    if (effectiveScheduleMode === 'now' && !canStartNow) {
      setPayError(
        doctor && !doctor.is_online
          ? 'This doctor is currently unavailable. Please choose another doctor.'
          : doctorScheduledSoon
            ? 'This doctor has a scheduled consultation starting soon. Please choose another doctor or schedule a consultation.'
            : 'This doctor is currently in another consultation. Please try again in a few minutes or choose another doctor.'
      )
      return
    }
    setBooking(true)
    let createdConsultationId: string | null = null
    try {
      // Final busy/scheduled-soon re-check right before payment — the
      // periodic poll above could be stale by up to 10s, and the patient
      // must never be charged for an On-Demand consultation with a doctor
      // who became unavailable in that window. book_appointment_slot() also
      // enforces both server-side (DOCTOR_BUSY / DOCTOR_SCHEDULED_SOON
      // below) as the authoritative last-resort guard.
      if (effectiveScheduleMode === 'now' && await checkDoctorBusy(doctorId)) {
        setDoctorBusy(true)
        setPayError('This doctor is currently in another consultation. Please try again in a few minutes or choose another doctor.')
        setBooking(false)
        return
      }

      if (effectiveScheduleMode === 'now' && await checkDoctorScheduledSoon(doctorId)) {
        setDoctorScheduledSoon(true)
        setPayError('This doctor has a scheduled consultation starting soon. Please choose another doctor or schedule a consultation.')
        setBooking(false)
        return
      }

      const token = await withTimeout(getToken(), 15000, 'Connection timed out. Please check your network and try again.')
      if (!token || !user) throw new Error('Not authenticated')

      const client = getAuthClient(token)
      const { data: userData } = await withTimeout(
        client.from('users').select('id').eq('clerk_id', user.id).single(),
        15000,
        'Connection timed out. Please check your network and try again.',
      )
      if (!userData) throw new Error('User profile not found')

      const price = doctor ? (doctor[TYPE_META[selectedType].priceKey] as number) : 0

      const scheduledAt = effectiveScheduleMode === 'now'
        ? new Date().toISOString()
        : parseScheduledAt(days[selectedDay].value, selectedTime)

      const creditCoversAll = activeCredit !== null && price <= activeCredit.creditAmount
      const additionalRequired = activeCredit ? Math.max(0, price - activeCredit.creditAmount) : price

      // 1. Create consultation record — atomically claims the slot (prevents
      //    two patients double-booking the same doctor at the same time)
      const { data: newConsultationId, error: consultErr } = await withTimeout(
        client.rpc('book_appointment_slot', {
          p_patient_id:      userData.id,
          p_doctor_id:       doctorId,
          p_type:            selectedType,
          p_slot_start:      scheduledAt,
          p_slot_duration:   SLOT_DURATION_MINS,
          p_patient_amount:  price,
          p_is_on_demand:    effectiveScheduleMode === 'now',
        }),
        15000,
        'Booking request timed out. Please check your connection and try again.',
      )

      if (consultErr || !newConsultationId) {
        const msg = consultErr?.message ?? ''
        if (msg.includes('SLOT_TAKEN')) {
          throw new Error('This time slot was just booked by someone else. Please pick another time.')
        }
        if (msg.includes('ON_DEMAND_DISABLED')) {
          throw new Error('This doctor is not accepting on-demand consultations right now.')
        }
        if (msg.includes('DOCTOR_SCHEDULED_SOON')) {
          throw new Error('This doctor has a scheduled consultation starting soon. Please choose another doctor or schedule a consultation.')
        }
        if (msg.includes('DOCTOR_BUSY')) {
          throw new Error('This doctor is currently in another consultation. Please try again in a few minutes or choose another doctor.')
        }
        if (msg.includes('DOCTOR_OFFLINE')) {
          throw new Error('This doctor is currently unavailable. Please choose another doctor.')
        }
        if (msg.includes('DOCTOR_UNAVAILABLE')) {
          throw new Error('This doctor is currently unavailable. Please choose another doctor.')
        }
        if (msg.includes('SLOT_EXPIRED')) {
          throw new Error('This time slot has already passed. Please select another available time.')
        }
        if (msg.includes('PATIENT_BUSY')) {
          throw new Error('You already have an active consultation. Please finish it before starting a new one.')
        }
        if (msg.includes('SCHEDULED_DISABLED')) {
          throw new Error('This doctor is not accepting scheduled appointments right now.')
        }
        if (msg.includes('DAY_OFF')) {
          throw new Error('This doctor is not available on the selected day.')
        }
        if (msg.includes('DATE_BLOCKED')) {
          throw new Error('This doctor is unavailable on the selected date.')
        }
        if (msg.includes('OUTSIDE_HOURS')) {
          throw new Error("This time is outside the doctor's working hours. Please pick another time.")
        }
        if (msg.includes('RATE_LIMITED')) {
          throw new Error('Too many booking attempts in a short time. Please wait a moment and try again.')
        }
        throw new Error("We couldn't complete this booking. Please try again.")
      }
      createdConsultationId = newConsultationId as string

      const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? ''
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

      // 2. Full credit coverage — apply credit via edge function, skip Chapa
      if (creditCoversAll && activeCredit) {
        const clerkToken = await withTimeout(getToken(), 15000, 'Connection timed out. Please check your network and try again.')

        // Bounded with a timeout — without it, a stalled network/edge-function
        // call left this promise unresolved forever, stranding the UI on
        // "Applying your credit…" with no way to recover (see the
        // initialize-payment call below, which has always had this protection).
        const creditController = new AbortController()
        const creditTimeoutId = setTimeout(() => creditController.abort(), 20000)

        let creditResp: Response
        try {
          creditResp = await fetch(`${supabaseUrl}/functions/v1/apply-credit`, {
            method: 'POST',
            signal: creditController.signal,
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${clerkToken}`,
              'apikey':        supabaseAnonKey,
            },
            body: JSON.stringify({
              credit_consultation_id: activeCredit.creditConsultationId,
              new_consultation_id:    createdConsultationId,
            }),
          })
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            throw new Error('Applying your credit timed out. Please try again.')
          }
          throw err
        } finally {
          clearTimeout(creditTimeoutId)
        }
        if (!creditResp.ok) {
          const d = await creditResp.json()
          throw new Error(d?.error ?? 'Failed to apply consultation credit')
        }
        // "Now" bookings go straight to the waiting room. Scheduled bookings
        // must not — apply-credit already left status='scheduled' for these,
        // matching the Chapa path in patient/payment/return.
        window.location.href = effectiveScheduleMode === 'now'
          ? `/patient/waiting/${createdConsultationId}`
          : '/patient/appointments'
        return
      }

      // 3. Partial credit — record credit_source_id via initialize-payment then pay difference
      // return_url — use actual origin so Chapa redirects back to the right domain
      const returnUrl = `${window.location.origin}/patient/payment/return?consultation_id=${createdConsultationId}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      // initialize-payment verifies this Clerk session server-side and
      // re-derives the charge amount from the DB itself — the anon key alone
      // used to be sent here, which let any caller act on any consultation.
      const paymentClerkToken = await withTimeout(getToken(), 15000, 'Connection timed out. Please check your network and try again.')

      let payResp: Response
      try {
        payResp = await fetch(`${supabaseUrl}/functions/v1/initialize-payment`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${paymentClerkToken}`,
            'apikey':        supabaseAnonKey,
          },
          body: JSON.stringify({
            consultation_id:  createdConsultationId,
            amount:           activeCredit ? additionalRequired : price,
            email:            user.primaryEmailAddress?.emailAddress ?? '',
            first_name:       user.firstName  ?? 'Patient',
            last_name:        user.lastName   ?? '-',
            type:             selectedType,
            doctor_name:      doctor?.user?.full_name ?? 'Doctor',
            return_url:       returnUrl,
            ...(activeCredit ? { credit_source_id: activeCredit.creditConsultationId } : {}),
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      const payData = await payResp.json()

      if (!payResp.ok || !payData?.checkout_url) {
        console.error('[Booking] Payment initialization failed:', payData)
        const raw = payData?.error
        const msg = typeof raw === 'string' && raw.length
          ? raw
          : typeof raw === 'object' && raw !== null
            ? JSON.stringify(raw)
            : 'Could not start payment. Please try again.'
        throw new Error(msg)
      }

      // 4. Redirect browser to Chapa checkout
      window.location.href = payData.checkout_url
    } catch (err: any) {
      // Cancel the orphaned pending consultation if payment setup failed
      if (createdConsultationId) {
        try {
          const token = await getToken()
          if (token) {
            const client = getAuthClient(token)
            await client.from('consultations').update({ status: 'cancelled' }).eq('id', createdConsultationId)
          }
        } catch {
          // best effort
        }
      }
      const msg = err?.name === 'AbortError'
        ? 'Payment request timed out. Please check your connection and try again.'
        : (err?.message ?? 'Something went wrong. Please try again.')
      setPayError(msg)
      setBooking(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading…</div>
      </div>
    )
  }

  if (!doctor) {
    return (
      <div className="p-8 text-center">
        <p className="font-montserrat font-bold text-ink-black">Doctor not found</p>
        <Link href="/patient/doctors" className="btn-primary mt-4 inline-flex h-10 px-6 text-sm rounded-xl">Back</Link>
      </div>
    )
  }

  const price = doctor[TYPE_META[selectedType].priceKey] as number
  const platformFee = Math.round(price * commissionRate / 100)
  const SelectedTypeIcon = TYPE_META[selectedType].icon

  const STEPS = ['Type', 'Timing', 'Review', 'Payment']

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back */}
      <Link href={`/patient/doctors/${doctorId}`} className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors">
        ← Back to Profile
      </Link>

      <h1 className="font-montserrat font-black text-2xl text-ink-black mb-1">Book Consultation</h1>
      <p className="text-ink-black/50 text-sm mb-6 flex items-center gap-1.5">
        with Dr. {stripDrPrefix(doctor.user?.full_name ?? '')} · {doctor.specialty}
        {doctor.status === 'approved' && <VerifiedBadge size={14} />}
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => {
          const n = (i + 1) as Step
          const done = step > n
          const active = step === n
          return (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                done ? 'bg-success text-white' : active ? 'bg-int-blue text-white' : 'bg-steel-grey text-ink-black/40'
              }`}>
                {done ? <Check size={14} /> : n}
              </div>
              <span className={`text-[10px] font-semibold hidden sm:block ${active ? 'text-int-blue' : 'text-ink-black/40'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${done ? 'bg-success' : 'bg-steel-grey'}`} />}
            </div>
          )
        })}
      </div>

      {/* Step 1 — Choose type */}
      {step === 1 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Choose Consultation Type</h2>
          {activeCredit && !creditLoading && (
            <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
              <Wallet size={16} className="text-teal-600 shrink-0" />
              <p className="text-teal-700 text-xs leading-relaxed">
                You have an unused {TYPE_META[activeCredit.type].label} credit — it can only be applied to another {TYPE_META[activeCredit.type].label.toLowerCase()}.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-3 mb-6">
            {(Object.entries(TYPE_META) as [ConsultType, typeof TYPE_META[ConsultType]][]).map(([key, meta]) => {
              const locked = Boolean(activeCredit) && key !== activeCredit?.type
              return (
                <button
                  key={key}
                  onClick={() => { if (!locked) setSelectedType(key) }}
                  disabled={locked}
                  className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                    locked
                      ? 'border-steel-grey opacity-50 cursor-not-allowed'
                      : selectedType === key ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
                  }`}
                >
                  <meta.icon size={24} className={locked ? 'text-ink-black/30' : 'text-int-blue'} />
                  <div className="flex-1">
                    <p className="font-montserrat font-bold text-sm text-ink-black">{meta.label}</p>
                  </div>
                  <span className="font-bold text-sm text-ink-black">
                    {doctor[meta.priceKey] ? `ETB ${doctor[meta.priceKey]}` : 'Free'}
                  </span>
                </button>
              )
            })}
          </div>
          <button onClick={() => setStep(2)} className="btn-primary w-full">Continue →</button>
        </div>
      )}

      {/* Step 2 — Timing */}
      {step === 2 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">When do you want to consult?</h2>
          <div className="flex flex-col gap-3 mb-6">
            <button
              onClick={() => canStartNow && setScheduleMode('now')}
              disabled={!canStartNow}
              className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                !canStartNow ? 'border-steel-grey opacity-50 cursor-not-allowed'
                  : effectiveScheduleMode === 'now' ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
              }`}
            >
              <Zap size={22} className="text-int-blue" />
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">Right Now — On Demand</p>
                <p className="text-ink-black/50 text-xs">
                  {!doctor?.is_online
                    ? 'Doctor is currently offline'
                    : doctorBusy
                      ? 'Doctor is currently in another consultation'
                      : doctorScheduledSoon
                        ? 'Doctor has a scheduled consultation starting soon'
                        : 'Doctor will be notified immediately'}
                </p>
              </div>
            </button>
            <button
              onClick={() => setScheduleMode('schedule')}
              className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                effectiveScheduleMode === 'schedule' ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
              }`}
            >
              <Calendar size={22} className="text-int-blue" />
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">Schedule for Later</p>
                <p className="text-ink-black/50 text-xs">Pick a future date and time slot</p>
              </div>
            </button>
          </div>

          {effectiveScheduleMode === 'schedule' && (
            <div className="mb-6">
              <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Date</p>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                {days.map((day, idx) => (
                  <button
                    key={day.value}
                    onClick={() => setSelectedDay(idx)}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedDay === idx ? 'bg-care-blue text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Time</p>
              {(() => {
                const dayValue = days[selectedDay].value
                const slots = getAvailableSlots(doctor?.availability ?? null, dayValue)
                if (slots.length === 0) {
                  const dayName = DAY_NAMES[new Date(dayValue + 'T12:00:00').getDay()]
                  const cfg = (doctor?.availability as any)?.[dayName]
                  const blocked = ((doctor?.availability as any)?.blocked_dates as string[] | undefined)?.includes(dayValue)
                  const message = blocked
                    ? 'This doctor is unavailable on the selected date. Please select another date.'
                    : !cfg?.enabled
                      ? `This doctor is not available on ${dayName}. Please select another date.`
                      : 'No available slots for this day. Please select another date.'
                  return (
                    <p className="text-ink-black/40 text-xs py-3">{message}</p>
                  )
                }
                return (
                  <>
                    <div className="flex items-center gap-4 text-[11px] text-ink-black/60 mb-3">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-md bg-success/10 border border-success inline-block" /> Available
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-md bg-danger/10 border border-danger inline-block" /> Booked
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {slots.map(slot => {
                        const isBooked = bookedSlots.has(slot)
                        const isPast = !isBooked && isSlotPast(dayValue, slot, nowMs)
                        const isDisabled = isBooked || isPast
                        return (
                          <button
                            key={slot}
                            onClick={() => !isDisabled && setSelectedTime(slot)}
                            disabled={isDisabled}
                            className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                              isBooked
                                ? 'bg-danger/10 text-ink-black/40 border border-danger opacity-70 cursor-not-allowed'
                                : isPast
                                  ? 'bg-steel-grey/20 text-ink-black/40 border border-steel-grey opacity-60 cursor-not-allowed'
                                  : selectedTime === slot ? 'bg-care-blue text-white' : 'bg-success/10 text-ink-black/60 border border-success'
                            }`}
                          >
                            {slot}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="btn-outline flex-1">← Back</button>
            <button
              onClick={() => setStep(3)}
              disabled={effectiveScheduleMode === 'schedule' && (!selectedTime || bookedSlots.has(selectedTime) || isSlotPast(days[selectedDay].value, selectedTime, nowMs))}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 3 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Review Your Booking</h2>

          <div className="bg-cloud-grey rounded-2xl p-4 mb-5 flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-black/60">Doctor</span>
              <span className="font-semibold text-ink-black">Dr. {stripDrPrefix(doctor.user?.full_name ?? '')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Specialty</span>
              <span className="font-semibold text-ink-black">{doctor.specialty}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Type</span>
              <span className="font-semibold text-ink-black inline-flex items-center gap-1.5">
                <SelectedTypeIcon size={14} /> {TYPE_META[selectedType].label}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Timing</span>
              <span className="font-semibold text-ink-black">
                {effectiveScheduleMode === 'now' ? 'On Demand' : `${days[selectedDay].label} at ${selectedTime}`}
              </span>
            </div>
            <div className="border-t border-steel-grey pt-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-ink-black/50">Consultation fee</span>
                <span className="text-ink-black">ETB {price}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-black/50">Platform fee ({commissionRate}%)</span>
                <span className="text-ink-black">ETB {platformFee}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-ink-black">Total</span>
                <span className="text-ink-black">ETB {price}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn-outline flex-1">← Back</button>
            <button onClick={() => setStep(4)} className="btn-primary flex-1">Continue →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Payment (Chapa or Credit) */}
      {step === 4 && (() => {
        const creditCoversAll = activeCredit !== null && price <= activeCredit.creditAmount
        const additionalRequired = activeCredit ? Math.max(0, price - activeCredit.creditAmount) : price

        return (
          <div className="card p-6 relative">
            {booking && (
              <div className="absolute inset-0 bg-white/80 rounded-2xl flex flex-col items-center justify-center z-10 gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-steel-grey border-t-int-blue animate-spin" />
                <p className="font-montserrat font-semibold text-sm text-ink-black">
                  {creditCoversAll ? 'Applying your credit…' : 'Preparing your payment…'}
                </p>
              </div>
            )}

            <h2 className="font-montserrat font-black text-xl text-ink-black mb-1">
              {creditCoversAll ? 'Confirm with Credit' : 'Pay with Chapa'}
            </h2>
            <p className="text-ink-black/50 text-sm mb-5">
              {creditCoversAll ? 'Your consultation credit covers this booking.' : 'Secure payment powered by Chapa'}
            </p>

            {/* Order summary */}
            <div className="bg-cloud-grey rounded-2xl p-4 mb-5 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-black/60">Consultation</span>
                <span className="font-semibold text-ink-black inline-flex items-center gap-1.5">
                <SelectedTypeIcon size={14} /> {TYPE_META[selectedType].label}
              </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-black/60">Doctor</span>
                <span className="font-semibold text-ink-black">Dr. {stripDrPrefix(doctor?.user?.full_name ?? '')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-black/60">Consultation Fee</span>
                <span className="font-semibold text-ink-black">ETB {price}</span>
              </div>
              {activeCredit && (
                <div className="flex justify-between text-teal-700">
                  <span>Consultation Credit</span>
                  <span className="font-semibold">-ETB {activeCredit.creditAmount}</span>
                </div>
              )}
              <div className="border-t border-steel-grey pt-2 flex justify-between font-bold">
                <span className="text-ink-black">{creditCoversAll ? 'Total Due' : 'Additional Payment'}</span>
                <span className="text-teal-600">
                  {creditCoversAll ? 'ETB 0' : `ETB ${additionalRequired}`}
                </span>
              </div>
            </div>

            {/* Credit notice */}
            {activeCredit && !creditLoading && (
              <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-xl p-4 mb-5">
                <Wallet size={16} className="text-teal-600 shrink-0" />
                <p className="text-teal-700 text-xs leading-relaxed">
                  {creditCoversAll
                    ? `Your ETB ${activeCredit.creditAmount} credit covers the full amount. No payment required.`
                    : `Your ETB ${activeCredit.creditAmount} credit is applied. You only need to pay ETB ${additionalRequired} via Chapa.`}
                </p>
              </div>
            )}

            {/* Accepted payment methods — only when Chapa needed */}
            {!creditCoversAll && (
              <>
                <div className="flex flex-wrap gap-2 mb-5">
                  {['CBE Birr', 'Telebirr', 'Awash Bank', 'HelloCash', 'Amole'].map(m => (
                    <span key={m} className="px-3 py-1.5 rounded-lg bg-white border border-steel-grey text-xs font-semibold text-ink-black/70">
                      {m}
                    </span>
                  ))}
                </div>
                <p className="text-ink-black/40 text-xs mb-5">
                  You will be redirected to Chapa to complete your payment. Your booking is only confirmed after successful payment.
                </p>
              </>
            )}

            {payError && (
              <div className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 mb-4 text-sm text-error font-semibold">
                {payError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setStep(3); setPayError(null) }} className="btn-outline flex-1" disabled={booking}>← Back</button>
              <button
                onClick={() => { setPayError(null); initiateChapaPayment() }}
                disabled={booking || creditLoading}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {creditCoversAll
                  ? 'Confirm Booking →'
                  : activeCredit
                    ? `Pay ETB ${additionalRequired} →`
                    : `Pay ETB ${price} →`}
              </button>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
