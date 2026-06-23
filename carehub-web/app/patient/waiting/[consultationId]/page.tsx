'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { stripDrPrefix } from '@/lib/utils'
import Link from 'next/link'

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

export default function WaitingRoomPage() {
  const { consultationId } = useParams<{ consultationId: string }>()
  const router = useRouter()
  const [consultation, setConsultation] = useState<ConsultationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dots, setDots] = useState('.')
  const [status, setStatus] = useState<string>('waiting_for_doctor')
  const [declined, setDeclined] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const navigated = useRef(false)

  // Animated dots
  useEffect(() => {
    const interval = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 600)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false

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

      if (cancelled) return

      setConsultation(data as unknown as ConsultationData)
      setLoading(false)

      if (data?.status) setStatus(data.status)

      // Already accepted/in_progress by the time we load
      if (data?.status === 'accepted' || data?.status === 'in_progress' || data?.status === 'active') {
        navigated.current = true
        router.push(`/patient/consultation/${data.type}/${consultationId}`)
        return
      }

      // Declined/cancelled before we loaded
      if (data?.status === 'declined' || data?.status === 'cancelled') {
        navigated.current = true
        setStatus(data.status)
        setDeclined(true)
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
            router.push(`/patient/consultation/${updated.type}/${consultationId}`)
          } else if (updated.status === 'declined' || updated.status === 'cancelled') {
            navigated.current = true
            setDeclined(true)
          }
        })
        .subscribe()

      if (cancelled) {
        supabase.removeChannel(channel)
      } else {
        channelRef.current = channel
      }
    }

    load()

    return () => {
      cancelled = true
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  async function cancelConsultation() {
    if (navigated.current) return
    navigated.current = true
    await supabase
      .from('consultations')
      .update({ status: 'cancelled' })
      .eq('id', consultationId)
    router.push('/patient/appointments')
  }

  if (declined) {
    const creditAmount = consultation?.credit_amount ?? null
    const doctorName = consultation?.doctor?.user?.full_name
      ? stripDrPrefix(consultation.doctor.user.full_name)
      : 'The doctor'

    return (
      <div className="p-8 flex items-center justify-center min-h-[80vh]">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center text-3xl mx-auto mb-4">
            ❌
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
                <span className="text-teal-600 text-lg">💳</span>
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

          <Link
            href="/patient/doctors"
            className="btn-primary w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl"
          >
            🔍 Find Another Doctor
          </Link>
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

  const typeIcon = consultation.type === 'chat' ? '💬' : consultation.type === 'phone' ? '📞' : '🎥'
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
          ✓ Payment Successful
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
          {typeIcon} {typeLabel}
        </div>

        <h1 className="font-montserrat font-black text-xl text-ink-black mb-1">
          Waiting for Dr. {doctorName}{dots}
        </h1>
        <p className="text-ink-black/50 text-sm mb-4">
          {consultation.doctor?.specialty}
        </p>

        {/* Status badge */}
        <div className={`inline-flex items-center gap-2 border rounded-full px-4 py-1.5 text-xs font-semibold mb-6 ${statusColor}`}>
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

        <button
          onClick={cancelConsultation}
          className="btn-outline w-full text-danger border-danger/30 hover:bg-danger/5"
        >
          Cancel Request
        </button>
      </div>
    </div>
  )
}
