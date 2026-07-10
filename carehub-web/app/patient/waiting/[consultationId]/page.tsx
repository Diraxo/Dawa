'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { supabase, getAuthClient } from '@/lib/supabase'
import { stripDrPrefix } from '@/lib/utils'
import Link from 'next/link'
import {
  Clock, Wallet, Search, RefreshCw, XCircle, Ban, CalendarClock,
  MessageCircle, Phone, Video, CheckCircle2,
} from 'lucide-react'

interface ConsultationData {
  id: string
  type: string
  status: string
  credit_amount: number | null
  doctor: {
    id: string
    specialty: string
    bio: string
    user: { full_name: string; profile_photo_url: string | null } | null
  } | null
}

const CANCELLABLE_STATUSES = new Set(['waiting_for_doctor', 'pending_payment'])

export default function WaitingRoomPage() {
  const { consultationId } = useParams<{ consultationId: string }>()
  const router = useRouter()
  const { getToken, userId: clerkUserId } = useAuth()
  const [consultation, setConsultation] = useState<ConsultationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dots, setDots] = useState('.')
  const [status, setStatus] = useState<string>('waiting_for_doctor')
  const [declined, setDeclined] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  // The waiting room stays active until the doctor accepts/declines or the
  // patient cancels — no client-side countdown/timeout. A server-side
  // pg_cron job (see migration 023) is the sole source of a 'doctor_missed'
  // status; this page only reacts to that status arriving.
  const [timedOut, setTimedOut] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const navigated = useRef(false)
  const myUserIdRef = useRef<string | null>(null)

  // Resolve own internal user id (needed to stamp cancelled_by)
  useEffect(() => {
    if (!clerkUserId) return
    getToken().then(async (token) => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('users')
        .select('id')
        .eq('clerk_id', clerkUserId)
        .maybeSingle()
      if (data) myUserIdRef.current = data.id
    })
  }, [clerkUserId, getToken])

  // Animated dots
  useEffect(() => {
    const interval = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 600)
    return () => clearInterval(interval)
  }, [])

  // Polling fallback: every 3 s in case Realtime misses the status change
  useEffect(() => {
    if (timedOut || declined || cancelled) return
    const poll = async () => {
      if (navigated.current) return
      try {
        const { data } = await supabase
          .from('consultations')
          .select('id, type, status')
          .eq('id', consultationId)
          .single()
        if (!data || navigated.current) return
        const s = (data as unknown as { status: string; type: string }).status
        const t = (data as unknown as { status: string; type: string }).type
        if (s === 'accepted' || s === 'in_progress' || s === 'active') {
          navigated.current = true
          router.replace(`/patient/consultation/${t}/${consultationId}`)
        } else if (s === 'declined') {
          navigated.current = true
          setDeclined(true)
        } else if (s === 'cancelled') {
          navigated.current = true
          setCancelled(true)
        } else if (s === 'doctor_missed') {
          navigated.current = true
          setTimedOut(true)
        }
      } catch { /* network error — retry next tick */ }
    }
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, timedOut, declined])

  useEffect(() => {
    let unmounted = false

    async function load() {
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }

      const { data } = await supabase
        .from('consultations')
        .select('id, type, status, credit_amount, doctor:doctor_profiles(id, specialty, bio, user:users(full_name, profile_photo_url))')
        .eq('id', consultationId)
        .single()

      if (unmounted) return

      setConsultation(data as unknown as ConsultationData)
      setLoading(false)

      if (data?.status) setStatus(data.status)

      // Already accepted/in_progress by the time we load
      if (data?.status === 'accepted' || data?.status === 'in_progress' || data?.status === 'active') {
        navigated.current = true
        router.replace(`/patient/consultation/${data.type}/${consultationId}`)
        return
      }

      // Declined/cancelled before we loaded
      if (data?.status === 'declined') {
        navigated.current = true
        setStatus(data.status)
        setDeclined(true)
        return
      }
      if (data?.status === 'cancelled') {
        navigated.current = true
        setStatus(data.status)
        setCancelled(true)
        return
      }

      const channel = supabase
        .channel(`waiting-${consultationId}-${Date.now()}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `id=eq.${consultationId}`,
        }, payload => {
          const updated = payload.new as { status: string; type: string }
          setStatus(updated.status)

          if (navigated.current) return

          if (updated.status === 'accepted' || updated.status === 'in_progress' || updated.status === 'active') {
            navigated.current = true
            router.replace(`/patient/consultation/${updated.type}/${consultationId}`)
          } else if (updated.status === 'declined') {
            navigated.current = true
            setDeclined(true)
          } else if (updated.status === 'cancelled') {
            navigated.current = true
            setCancelled(true)
          } else if (updated.status === 'doctor_missed') {
            setTimedOut(true)
            navigated.current = true
          }
        })
        .subscribe()

      if (unmounted) {
        supabase.removeChannel(channel)
      } else {
        channelRef.current = channel
      }
    }

    load()

    return () => {
      unmounted = true
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  // Guarded to pre-acceptance statuses only — once the doctor has accepted
  // (or the session started), cancelling here would create an inconsistent
  // state; that case is handled by the live consultation pages instead.
  async function cancelConsultation() {
    if (cancelling || navigated.current) return
    if (!CANCELLABLE_STATUSES.has(status)) {
      setCancelError('This request can no longer be cancelled because the doctor has already responded.')
      return
    }
    setCancelling(true)
    setCancelError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const { data, error } = await getAuthClient(token)
        .from('consultations')
        .update({ status: 'cancelled', cancelled_by: myUserIdRef.current })
        .eq('id', consultationId)
        .select('credit_amount, consultation_credit')
        .single()
      if (error) throw error
      // Set navigated only now that the update is confirmed — the
      // realtime/poll handlers guard on navigated.current, so flipping it
      // earlier (before the update landed) would make them ignore the
      // resulting 'cancelled' status and leave the page stuck.
      navigated.current = true
      setConsultation(prev => prev ? { ...prev, credit_amount: data?.credit_amount ?? prev.credit_amount } : prev)
      setCancelled(true)
    } catch {
      setCancelError('Could not cancel your request. Please check your connection and try again.')
    } finally {
      setCancelling(false)
    }
  }

  if (timedOut) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[80vh]">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <Clock size={32} className="text-warning" />
          </div>
          <h1 className="font-montserrat font-black text-xl text-ink-black mb-2">
            No Response
          </h1>
          <p className="text-ink-black/50 text-sm mb-6">
            The doctor did not respond in time. Your consultation credit has been preserved.
          </p>
          <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mb-6 text-left">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-teal-600" />
              <p className="font-montserrat font-bold text-sm text-teal-800">Credit Preserved</p>
            </div>
            <p className="text-teal-600 text-xs leading-relaxed">
              No additional payment required when you book with another doctor at the same or lower fee.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/patient/doctors" className="btn-primary w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl">
              <Search size={16} /> Choose Another Doctor
            </Link>
            <Link href="/patient/doctors" className="btn-outline w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl text-ink-black border-steel-grey">
              <RefreshCw size={16} /> Try Again
            </Link>
            <Link href="/patient/help-support" className="text-ink-black/40 text-sm underline mt-1">
              Contact Support
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (declined) {
    const creditAmount = consultation?.credit_amount ?? null
    const doctorName = consultation?.doctor?.user?.full_name
      ? stripDrPrefix(consultation.doctor.user.full_name)
      : 'The doctor'

    return (
      <div className="p-8 flex items-center justify-center min-h-[80vh]">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-danger" />
          </div>
          <h1 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Consultation Unavailable
          </h1>
          <p className="text-ink-black/50 text-sm mb-6">
            Dr. {doctorName} is unavailable.
          </p>

          {/* Consultation Credit Banner */}
          {creditAmount !== null && creditAmount > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mb-6 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={18} className="text-teal-600" />
                <p className="font-montserrat font-bold text-sm text-teal-800">
                  Consultation Credit Available
                </p>
              </div>
              <p className="font-montserrat font-black text-2xl text-teal-700 mb-1">
                ETB {Number(creditAmount).toFixed(2)}
              </p>
              <p className="text-teal-600 text-xs leading-relaxed">
                Your consultation credit has been preserved. No additional payment required when booking with a doctor at the same or lower fee.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Link
              href="/patient/doctors"
              className="btn-primary w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl"
            >
              <Search size={16} /> Choose Another Doctor
            </Link>
            {consultation?.doctor?.id && (
              <Link
                href={`/patient/doctors/${consultation.doctor.id}`}
                className="btn-outline w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl text-ink-black border-steel-grey"
              >
                <CalendarClock size={16} /> Reschedule
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (cancelled) {
    const creditAmount = consultation?.credit_amount ?? null
    const doctorName = consultation?.doctor?.user?.full_name
      ? stripDrPrefix(consultation.doctor.user.full_name)
      : 'the doctor'

    return (
      <div className="p-8 flex items-center justify-center min-h-[80vh]">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-steel-grey/20 flex items-center justify-center mx-auto mb-4">
            <Ban size={32} className="text-ink-black/40" />
          </div>
          <h1 className="font-montserrat font-black text-xl text-ink-black mb-2">
            Request Cancelled
          </h1>
          <p className="text-ink-black/50 text-sm mb-6">
            You cancelled your consultation request with Dr. {doctorName}.
          </p>

          {/* Consultation Credit Banner */}
          {creditAmount !== null && creditAmount > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mb-6 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={18} className="text-teal-600" />
                <p className="font-montserrat font-bold text-sm text-teal-800">
                  Consultation Credit Preserved
                </p>
              </div>
              <p className="font-montserrat font-black text-2xl text-teal-700 mb-1">
                ETB {Number(creditAmount).toFixed(2)}
              </p>
              <p className="text-teal-600 text-xs leading-relaxed">
                No additional payment required when booking with a doctor at the same or lower fee.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {consultation?.doctor?.id && (
              <Link
                href={`/patient/doctors/${consultation.doctor.id}`}
                className="btn-primary w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl"
              >
                <CalendarClock size={16} /> Reschedule
              </Link>
            )}
            <Link
              href="/patient/doctors"
              className="btn-outline w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl text-ink-black border-steel-grey"
            >
              <Search size={16} /> Choose Another Doctor
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading…</div>
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="p-8 text-center">
        <p className="font-montserrat font-bold text-ink-black mb-4">Consultation not found</p>
        <Link href="/patient/appointments" className="btn-primary h-10 px-6 text-sm rounded-xl inline-flex">
          My Appointments
        </Link>
      </div>
    )
  }

  const TypeIcon = consultation.type === 'chat' ? MessageCircle : consultation.type === 'phone' ? Phone : Video
  const typeLabel = consultation.type === 'chat' ? 'Chat' : consultation.type === 'phone' ? 'Phone Call' : 'Video Call'
  const doctorName = stripDrPrefix(consultation.doctor?.user?.full_name ?? '')
  const photoUrl = consultation.doctor?.user?.profile_photo_url

  const statusLabel =
    status === 'accepted'    ? 'Accepted — Doctor is Ready'  :
    status === 'in_progress' ? 'In Progress'                 :
                               'Waiting for Doctor'

  const statusColor =
    status === 'accepted' || status === 'in_progress'
      ? 'text-teal-green bg-teal-green/10 border-teal-green/30'
      : 'text-care-blue bg-care-blue/10 border-care-blue/30'

  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[80vh]">
      <div className="card p-10 max-w-md w-full text-center">
        {/* Payment success badge */}
        <div className="inline-flex items-center gap-1.5 bg-success/10 text-success border border-success/30 rounded-full px-3 py-1 text-xs font-semibold mb-5">
          <CheckCircle2 size={14} /> Payment Successful
        </div>

        {/* Doctor avatar */}
        <div className="relative mx-auto mb-6 w-28 h-28">
          <div className="absolute inset-0 rounded-full bg-int-blue/20 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-int-blue/10 animate-ping" style={{ animationDelay: '0.3s' }} />
          {photoUrl ? (
            <img src={photoUrl} alt={doctorName} className="relative w-28 h-28 rounded-full object-cover shadow-blue" />
          ) : (
            <div className="relative w-28 h-28 rounded-full bg-gradient-interactive flex items-center justify-center text-white font-black text-4xl shadow-blue">
              {doctorName.charAt(0) || '?'}
            </div>
          )}
        </div>

        {/* Type badge */}
        <div className="inline-flex items-center gap-1.5 bg-cloud-grey rounded-full px-3 py-1 text-xs font-semibold text-ink-black mb-4">
          <TypeIcon size={14} /> {typeLabel}
        </div>

        <h1 className="font-montserrat font-black text-xl text-ink-black mb-1">
          Waiting for Dr. {doctorName}{dots}
        </h1>
        <p className="text-ink-black/50 text-sm mb-4">
          {consultation.doctor?.specialty}
        </p>

        {/* Status badge */}
        <div className={`inline-flex items-center gap-2 border rounded-full px-4 py-1.5 text-xs font-semibold mb-4 ${statusColor}`}>
          <span className={`w-2 h-2 rounded-full ${status === 'accepted' || status === 'in_progress' ? 'bg-teal-green' : 'bg-care-blue'} animate-pulse`} />
          {statusLabel}
        </div>

        {/* Message */}
        <p className="text-ink-black/50 text-sm mb-6 leading-relaxed">
          Your payment was successful. Your consultation request has been sent to the doctor. Please wait while the doctor reviews your request.
        </p>

        {/* Bio while waiting */}
        {consultation.doctor?.bio && (
          <div className="bg-cloud-grey rounded-2xl p-4 mb-6 text-left">
            <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">About Your Doctor</p>
            <p className="text-sm text-ink-black/60 leading-relaxed line-clamp-4">{consultation.doctor.bio}</p>
          </div>
        )}

        {cancelError && (
          <p className="text-danger text-xs mb-3 text-center">{cancelError}</p>
        )}

        <button
          onClick={cancelConsultation}
          disabled={cancelling}
          className="btn-outline w-full text-danger border-danger/30 hover:bg-danger/5 disabled:opacity-60"
        >
          {cancelling ? 'Cancelling…' : 'Cancel Request'}
        </button>
      </div>
    </div>
  )
}
