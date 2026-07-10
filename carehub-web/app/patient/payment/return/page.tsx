'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CheckCircle2, Clock } from 'lucide-react'

// Chapa redirects here after checkout.
// Standard web flow: ?consultation_id=...&status=success|failed
// Fallback: if consultation_id is absent, look up by ?tx_ref=...
// (Chapa preserves existing query params, but this guards against edge cases.)

type PageStatus = 'checking' | 'paid' | 'failed' | 'timeout'

interface ConfirmedDetails {
  doctorName: string
  typeLabel:  string
  amount:     number | null
  scheduledAt: string | null
}

// Mirrors the date/time formatting used on the mobile confirmation screen
// (payment-return.tsx's formatScheduledAt) so the copy reads the same way
// across platforms.
function formatScheduledAt(iso: string): string {
  const d = new Date(iso)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${dateStr} at ${timeStr}`
}

const TYPE_LABEL: Record<string, string> = {
  chat: 'Chat Consultation', phone: 'Phone Consultation', video: 'Video Consultation',
}

export default function PaymentReturnPage() {
  const searchParams   = useSearchParams()
  const router         = useRouter()
  const chapaStatus    = searchParams.get('status')
  const txRef          = searchParams.get('tx_ref')

  const [consultationId, setConsultationId] = useState<string | null>(
    searchParams.get('consultation_id'),
  )
  const [status, setStatus]     = useState<PageStatus>('checking')
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [bookingTiming, setBookingTiming] = useState<'now' | 'schedule'>('now')
  const [confirmedDetails, setConfirmedDetails] = useState<ConfirmedDetails | null>(null)
  const cancelledRef = useRef(false)
  const timingRef = useRef<'now' | 'schedule'>('now')

  const cancelConsultation = async (cid: string) => {
    await supabase
      .from('consultations')
      .update({ status: 'cancelled' })
      .eq('id', cid)
      .eq('payment_status', 'pending')
  }

  useEffect(() => {
    cancelledRef.current = false

    // Mobile app flow: web URL used as Chapa return_url to satisfy HTTPS requirement.
    // Redirect the in-app browser back to the app's deep-link scheme so
    // openAuthSessionAsync can close the session and hand control back to the app.
    const mobileRedirect = searchParams.get('mobile_redirect')
    if (mobileRedirect) {
      const fwd = new URLSearchParams()
      if (chapaStatus) fwd.set('status', chapaStatus)
      if (txRef) fwd.set('tx_ref', txRef)
      const sep = mobileRedirect.includes('?') ? '&' : '?'
      window.location.replace(`${mobileRedirect}${sep}${fwd.toString()}`)
      return
    }

    async function run() {
      // ── Resolve consultation_id ─────────────────────────────────────────────
      // Normally embedded in the return_url by the booking page. If absent
      // (e.g. stripped by an intermediate redirect), fall back to tx_ref lookup.
      let cid = searchParams.get('consultation_id')

      if (!cid && txRef) {
        const { data } = await supabase
          .from('consultations')
          .select('id, doctor_id')
          .eq('chapa_tx_ref', txRef)
          .maybeSingle()
        if (cancelledRef.current) return
        if (data?.id) {
          cid = data.id
          setConsultationId(data.id)
          if (data.doctor_id) setDoctorId(data.doctor_id)
        }
      }

      if (!cid) {
        setStatus('failed')
        return
      }

      // If Chapa explicitly reports failure, cancel immediately
      const chapaFailed =
        chapaStatus === 'failed' ||
        chapaStatus === 'payment_failed' ||
        chapaStatus === 'cancelled'

      if (chapaFailed) {
        await cancelConsultation(cid)
        if (!cancelledRef.current) setStatus('failed')
        return
      }

      // Poll until paid. Webhook usually arrives within 5 s; allow up to 3 minutes.
      const MAX_ATTEMPTS = 90
      let attempt = 0
      let intervalRef: ReturnType<typeof setInterval>

      const check = async () => {
        if (cancelledRef.current) return

        const { data } = await supabase
          .from('consultations')
          .select('id, payment_status, doctor_id, scheduled_at')
          .eq('id', cid!)
          .single()

        if (cancelledRef.current) return

        if (data?.doctor_id) setDoctorId(data.doctor_id)

        if (data?.scheduled_at) {
          const scheduledTime = new Date(data.scheduled_at)
          timingRef.current = scheduledTime > new Date(Date.now() + 60 * 60 * 1000) ? 'schedule' : 'now'
        }

        if (data?.payment_status === 'paid') {
          clearInterval(intervalRef)
          // "Now" bookings go straight to waiting_for_doctor (triggers the doctor
          // notification immediately). Scheduled bookings become 'scheduled' —
          // the scheduled-time cron flips them to waiting_for_doctor only once
          // scheduled_at arrives.
          //
          // waiting_started_at must be stamped here too, same as the credit path
          // in apply-credit/index.ts — it's the sort key doctor clients queue on
          // and what the patient waiting room displays as "waiting since".
          await supabase
            .from('consultations')
            .update({
              status: timingRef.current === 'now' ? 'waiting_for_doctor' : 'scheduled',
              ...(timingRef.current === 'now' ? { waiting_started_at: new Date().toISOString() } : {}),
            })
            .eq('id', cid!)
            .eq('payment_status', 'paid')

          // Fetch the doctor/type/amount so the confirmation screen can show
          // them together — the fields above (`select`) only cover polling.
          const { data: fullRow } = await supabase
            .from('consultations')
            .select('type, patient_amount, doctor_profiles!doctor_id(users!inner(full_name))')
            .eq('id', cid!)
            .maybeSingle()
          const doctorName = (fullRow as any)?.doctor_profiles?.users?.full_name ?? 'your doctor'
          const typeLabel = TYPE_LABEL[(fullRow as any)?.type ?? 'chat'] ?? 'Consultation'
          const amount = (fullRow as any)?.patient_amount != null ? Number((fullRow as any).patient_amount) : null

          setConfirmedDetails({ doctorName, typeLabel, amount, scheduledAt: data.scheduled_at ?? null })
          setBookingTiming(timingRef.current)
          setStatus('paid')

          // "Now" bookings auto-redirect to the waiting room. Scheduled
          // bookings stay on this screen — the patient explicitly continues
          // to their upcoming appointment instead of being auto-redirected,
          // matching the mobile confirmation screen.
          if (timingRef.current === 'now') {
            setTimeout(() => {
              router.replace(`/patient/waiting/${cid}`)
            }, 1500)
          }
          return
        }

        attempt++
        if (attempt >= MAX_ATTEMPTS) {
          clearInterval(intervalRef)
          if (chapaStatus !== 'success') {
            await cancelConsultation(cid!)
            setStatus('failed')
          } else {
            setStatus('timeout')
          }
        }
      }

      check()
      intervalRef = setInterval(check, 2000)

      return () => {
        cancelledRef.current = true
        clearInterval(intervalRef)
      }
    }

    run()

    return () => { cancelledRef.current = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Verifying ───────────────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-int-blue/10 flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-4 border-int-blue border-t-transparent rounded-full animate-spin" />
          </div>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Verifying Payment
          </h2>
          <p className="text-ink-black/50 text-sm">Confirming your payment with Chapa…</p>
          <p className="text-ink-black/30 text-xs mt-3">This usually takes just a few seconds.</p>
        </div>
      </div>
    )
  }

  // ── Confirmed ────────────────────────────────────────────────────────────────
  if (status === 'paid') {
    // Scheduled bookings get a distinct confirmation panel — no waiting-room
    // copy, and the patient explicitly continues on to their upcoming
    // appointment rather than being auto-redirected. Matches the mobile
    // confirmation screen (app/(patient)/payment-return.tsx).
    if (bookingTiming === 'schedule') {
      const formattedWhen = confirmedDetails?.scheduledAt ? formatScheduledAt(confirmedDetails.scheduledAt) : null
      return (
        <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
          <div className="card max-w-sm w-full p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={30} className="text-success" />
            </div>
            <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
              Appointment Scheduled
            </h2>
            <p className="text-ink-black/50 text-sm mb-6">
              Your appointment is scheduled for{' '}
              {formattedWhen ? <span className="font-semibold text-ink-black">{formattedWhen}</span> : 'the selected time'}
            </p>

            <div className="text-left rounded-2xl border border-steel-grey divide-y divide-steel-grey mb-4">
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-black/50 text-sm">Doctor</span>
                <span className="text-ink-black text-sm font-semibold">{confirmedDetails?.doctorName ?? 'your doctor'}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-black/50 text-sm">Type</span>
                <span className="text-ink-black text-sm font-semibold">{confirmedDetails?.typeLabel ?? 'Consultation'}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-black/50 text-sm">Amount Paid</span>
                <span className="text-ink-black text-sm font-semibold">
                  {confirmedDetails?.amount != null ? `ETB ${confirmedDetails.amount.toFixed(2)}` : '—'}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-black/50 text-sm">Status</span>
                <span className="text-success text-sm font-semibold">Paid</span>
              </div>
            </div>

            <p className="text-ink-black/40 text-xs mb-6">
              Please watch for notifications confirming your upcoming consultation.
            </p>

            <button onClick={() => router.replace('/patient/appointments')} className="btn-primary w-full">
              Continue
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={30} className="text-success" />
          </div>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Payment Confirmed!
          </h2>
          <p className="text-ink-black/50 text-sm">Taking you to the waiting room…</p>
        </div>
      </div>
    )
  }

  // ── Webhook delay ────────────────────────────────────────────────────────────
  if (status === 'timeout') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <Clock size={30} className="text-warning" />
          </div>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Payment Processing
          </h2>
          <p className="text-ink-black/50 text-sm mb-6">
            Your payment was received by Chapa but is still being confirmed on our end.
            Please check your appointments in a few minutes — your booking will appear there once confirmed.
          </p>
          <button
            onClick={() => router.replace('/patient/appointments')}
            className="btn-primary w-full"
          >
            View My Appointments
          </button>
        </div>
      </div>
    )
  }

  // ── Failed / cancelled ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
      <div className="card max-w-sm w-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
          Payment Failed
        </h2>
        <p className="text-ink-black/50 text-sm mb-6">
          Your payment was not completed. No charge has been made to your account.
          Please try booking again.
        </p>
        <button
          onClick={() => {
            if (doctorId) {
              router.replace(`/patient/booking/${doctorId}`)
            } else {
              router.replace('/patient/doctors')
            }
          }}
          className="btn-primary w-full mb-3"
        >
          Try Again
        </button>
        <button
          onClick={() => router.replace('/patient/doctors')}
          className="btn-outline w-full"
        >
          Browse Doctors
        </button>
      </div>
    </div>
  )
}
