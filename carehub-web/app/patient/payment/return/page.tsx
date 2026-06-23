'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Chapa redirects here after checkout with ?consultation_id=...&status=success|failed
// We poll for the webhook to confirm payment before sending the patient to waiting room.
// If payment failed or webhook never arrives, we cancel the orphaned consultation
// and send the patient back to retry booking from scratch.

type PageStatus = 'checking' | 'paid' | 'failed' | 'timeout'

export default function PaymentReturnPage() {
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const consultationId  = searchParams.get('consultation_id')
  const chapaStatus     = searchParams.get('status') // 'success' | 'failed' | 'payment_failed'

  const [status, setStatus]   = useState<PageStatus>('checking')
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  // Cancel the consultation and mark local state as failed
  const cancelConsultation = async (cid: string) => {
    // Only cancel if payment was never confirmed — guard prevents double-firing
    await supabase
      .from('consultations')
      .update({ status: 'cancelled' })
      .eq('id', cid)
      .eq('payment_status', 'pending')
  }

  useEffect(() => {
    // Reset on every effect run so React 18 Strict Mode double-invoke doesn't
    // leave this permanently true from the first run's cleanup.
    cancelledRef.current = false

    // Mobile app flow: the web URL was used as Chapa's return_url to satisfy the HTTPS
    // requirement. Redirect the in-app browser back to the app's deep-link scheme so
    // openAuthSessionAsync can close the session and hand control back to the app.
    const mobileRedirect = searchParams.get('mobile_redirect')
    if (mobileRedirect) {
      const fwd = new URLSearchParams()
      if (chapaStatus) fwd.set('status', chapaStatus)
      const txRef = searchParams.get('tx_ref')
      if (txRef) fwd.set('tx_ref', txRef)
      const sep = mobileRedirect.includes('?') ? '&' : '?'
      window.location.replace(`${mobileRedirect}${sep}${fwd.toString()}`)
      return
    }

    if (!consultationId) {
      setStatus('failed')
      return
    }

    // If Chapa explicitly reports failure, cancel immediately — no need to poll
    const chapaFailed =
      chapaStatus === 'failed' ||
      chapaStatus === 'payment_failed' ||
      chapaStatus === 'cancelled'

    if (chapaFailed) {
      cancelConsultation(consultationId).then(() => setStatus('failed'))
      return
    }

    // Poll until paid. Webhook usually arrives within 5 s; allow up to 3 minutes
    // for slow networks or sandbox delays before giving up.
    const MAX_ATTEMPTS = 90 // 3 minutes at 2 s intervals
    let attempt = 0
    let intervalRef: ReturnType<typeof setInterval>

    const check = async () => {
      if (cancelledRef.current) return

      const { data } = await supabase
        .from('consultations')
        .select('id, payment_status, doctor_id')
        .eq('id', consultationId)
        .single()

      if (cancelledRef.current) return

      if (data?.doctor_id) setDoctorId(data.doctor_id)

      if (data?.payment_status === 'paid') {
        clearInterval(intervalRef)
        // Set waiting_for_doctor — this triggers the DB notification to the doctor
        await supabase
          .from('consultations')
          .update({ status: 'waiting_for_doctor' })
          .eq('id', consultationId)
          .eq('payment_status', 'paid')
        setStatus('paid')
        setTimeout(() => {
          router.replace(`/patient/waiting/${consultationId}`)
        }, 1500)
        return
      }

      attempt++
      if (attempt >= MAX_ATTEMPTS) {
        clearInterval(intervalRef)
        // Webhook never arrived — if Chapa said success we leave the record open
        // so admin can verify; if unknown we cancel to avoid orphan records.
        if (chapaStatus !== 'success') {
          await cancelConsultation(consultationId)
          setStatus('failed')
        } else {
          // Likely a webhook delay — don't cancel, just tell patient to wait
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center text-3xl mx-auto mb-4">
            ✅
          </div>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Payment Confirmed!
          </h2>
          <p className="text-ink-black/50 text-sm">Taking you to the waiting room…</p>
        </div>
      </div>
    )
  }

  // ── Webhook delay (Chapa said success but webhook hasn't arrived yet) ────────
  if (status === 'timeout') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey px-4">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center text-3xl mx-auto mb-4">
            🕐
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

  // ── Failed / cancelled — send patient back to book again ─────────────────────
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
