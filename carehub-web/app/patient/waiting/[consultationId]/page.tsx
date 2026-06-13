'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import Link from 'next/link'

interface ConsultationData {
  id: string
  type: string
  status: string
  doctor: {
    id: string
    specialty: string
    bio: string
    user: { full_name: string } | null
  } | null
}

export default function WaitingRoomPage() {
  const { consultationId } = useParams<{ consultationId: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const [consultation, setConsultation] = useState<ConsultationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dots, setDots] = useState('.')
  const [countdown, setCountdown] = useState(30)
  const [timedOut, setTimedOut] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 600)
    return () => clearInterval(interval)
  }, [])

  // 30-second countdown — auto-cancel if doctor doesn't respond
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          handleTimeout()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleTimeout() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setTimedOut(true)
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    await client.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    setTimeout(() => router.push('/patient/appointments'), 2000)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, type, status, doctor:doctor_profiles(id, specialty, bio, user:users(full_name))')
        .eq('id', consultationId)
        .single()
      setConsultation(data as unknown as ConsultationData)
      setLoading(false)

      if (data?.status === 'active') {
        if (countdownRef.current) clearInterval(countdownRef.current)
        navigateToConsultation(data.type)
        return
      }

      channelRef.current = supabase
        .channel(`waiting-${consultationId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `id=eq.${consultationId}`,
        }, payload => {
          const updated = payload.new as { status: string; type: string }
          if (updated.status === 'active') {
            if (countdownRef.current) clearInterval(countdownRef.current)
            navigateToConsultation(updated.type)
          } else if (updated.status === 'cancelled') {
            if (countdownRef.current) clearInterval(countdownRef.current)
            router.push('/patient/appointments?cancelled=1')
          }
        })
        .subscribe()
    }
    load()
    return () => { channelRef.current?.unsubscribe() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  function navigateToConsultation(type: string) {
    router.push(`/patient/consultation/${type}/${consultationId}`)
  }

  async function cancelConsultation() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    await client.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    router.push('/patient/appointments')
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

  // Timed out — show message before redirect
  if (timedOut) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[80vh]">
        <div className="card p-10 max-w-md w-full text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="font-montserrat font-black text-xl text-ink-black mb-2">Request Timed Out</h1>
          <p className="text-ink-black/50 text-sm">No doctor accepted your request in time. Redirecting to appointments…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[80vh]">
      <div className="card p-10 max-w-md w-full text-center">
        {/* Animated avatar */}
        <div className="relative mx-auto mb-6 w-28 h-28">
          <div className="absolute inset-0 rounded-full bg-int-blue/20 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-int-blue/10 animate-ping" style={{ animationDelay: '0.3s' }} />
          <div className="relative w-28 h-28 rounded-full bg-gradient-interactive flex items-center justify-center text-white font-black text-4xl shadow-blue">
            {consultation.doctor?.user?.full_name?.charAt(0) ?? '?'}
          </div>
        </div>

        {/* Type badge */}
        <div className="inline-flex items-center gap-1.5 bg-cloud-grey rounded-full px-3 py-1 text-xs font-semibold text-ink-black mb-4">
          {typeIcon} {typeLabel}
        </div>

        <h1 className="font-montserrat font-black text-xl text-ink-black mb-1">
          Waiting for Dr. {consultation.doctor?.user?.full_name}{dots}
        </h1>
        <p className="text-ink-black/50 text-sm mb-2">
          {consultation.doctor?.specialty}
        </p>

        {/* Countdown ring */}
        <div className={`w-16 h-16 rounded-full border-4 mx-auto my-4 flex items-center justify-center font-black text-xl ${
          countdown <= 10 ? 'border-danger text-danger' : 'border-care-blue text-care-blue'
        }`}>
          {countdown}
        </div>
        <p className="text-ink-black/40 text-xs mb-6">
          seconds remaining for the doctor to accept
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
