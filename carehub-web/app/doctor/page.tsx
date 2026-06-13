'use client'

import { useEffect, useState, useRef } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getAuthClient, supabase } from '@/lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'
import { getGreeting } from '@/lib/utils'
import { MessageCircle, Phone, Video, ClipboardList, CheckCircle2, Star, Wallet, Calendar, User } from 'lucide-react'

interface DoctorStats {
  totalConsultations: number
  completedToday: number
  rating: number
  earnings: number
  isOnline: boolean
  profileId: string | null
  status: string
}

interface IncomingRequest {
  id: string
  type: string
  patientName: string
  amount: number
}

export default function DoctorHomePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DoctorStats>({
    totalConsultations: 0, completedToday: 0, rating: 0, earnings: 0, isOnline: false, profileId: null, status: ''
  })
  const [loading, setLoading] = useState(true)
  const [request, setRequest] = useState<IncomingRequest | null>(null)
  const [countdown, setCountdown] = useState(30)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!user) return
    loadStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (request) {
      setCountdown(30)
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            handleDecline(request.id)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

  async function loadStats() {
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    const { data: userData } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
    if (!userData) { setLoading(false); return }

    const { data: profile } = await client
      .from('doctor_profiles')
      .select('id, rating_average, total_consultations, is_online, status')
      .eq('user_id', userData.id)
      .single()

    if (!profile) { setLoading(false); return }

    const today = new Date().toISOString().split('T')[0]
    const [{ count: completedToday }, { data: earningsData }] = await Promise.all([
      client.from('consultations').select('id', { count: 'exact', head: true })
        .eq('doctor_id', profile.id).eq('status', 'completed').gte('created_at', today),
      client.from('consultations').select('doctor_amount')
        .eq('doctor_id', profile.id).eq('status', 'completed'),
    ])

    const earnings = (earningsData ?? []).reduce((sum, r) => sum + (r.doctor_amount ?? 0), 0)

    setStats({
      totalConsultations: profile.total_consultations ?? 0,
      completedToday: completedToday ?? 0,
      rating: profile.rating_average ?? 0,
      earnings,
      isOnline: profile.is_online ?? false,
      profileId: profile.id,
      status: profile.status,
    })
    setLoading(false)

    if (profile.id) {
      channelRef.current = supabase
        .channel(`doctor-home-${profile.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${profile.id}`,
        }, async payload => {
          const c = payload.new as { id: string; type: string; patient_id: string; patient_amount: number }
          const { data: pat } = await supabase.from('users').select('full_name').eq('id', c.patient_id).single()
          setRequest({ id: c.id, type: c.type, patientName: pat?.full_name ?? 'Patient', amount: c.patient_amount ?? 0 })
        })
        .subscribe()
    }
  }

  async function toggleOnline() {
    if (!stats.profileId) return
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    const newStatus = !stats.isOnline
    await client.from('doctor_profiles').update({ is_online: newStatus }).eq('id', stats.profileId)
    setStats(prev => ({ ...prev, isOnline: newStatus }))
  }

  async function handleAccept(consultId: string) {
    if (timerRef.current) clearInterval(timerRef.current)
    const token = await getToken()
    if (token) {
      const client = getAuthClient(token)
      await client.from('consultations').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', consultId)
    }
    const type = request?.type ?? 'chat'
    setRequest(null)
    router.push(`/doctor/consultation/${type}/${consultId}`)
  }

  async function handleDecline(id: string) {
    if (timerRef.current) clearInterval(timerRef.current)
    const token = await getToken()
    if (token) {
      const client = getAuthClient(token)
      await client.from('consultations').update({ status: 'cancelled' }).eq('id', id)
    }
    setRequest(null)
  }

  if (stats.status && stats.status !== 'approved') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-[60vh]">
        <div className="card p-12 text-center max-w-md">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="font-montserrat font-black text-2xl text-ink-black mb-2">Under Review</h1>
          <p className="text-ink-black/50 text-sm">
            Your application is being reviewed. You&apos;ll be notified once approved.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl relative">
      {/* Incoming request overlay */}
      {request && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 rounded-3xl bg-gradient-interactive flex items-center justify-center mx-auto mb-3 animate-bounce-sm">
              {request.type === 'chat'
                ? <MessageCircle size={30} className="text-white" />
                : request.type === 'phone'
                  ? <Phone size={30} className="text-white" />
                  : <Video size={30} className="text-white" />}
            </div>
            <h2 className="font-montserrat font-black text-xl text-ink-black mb-1">Incoming Request</h2>
            <p className="text-ink-black/60 text-sm mb-1">{request.patientName} wants a {request.type} consultation</p>
            <p className="text-teal-green font-bold text-sm mb-4">ETB {request.amount}</p>

            <div className="w-16 h-16 rounded-full border-4 border-care-blue mx-auto flex items-center justify-center mb-6">
              <span className="font-black text-2xl text-care-blue">{countdown}</span>
            </div>

            <div className="flex gap-3">
              <button onClick={() => handleDecline(request.id)}
                className="flex-1 h-12 rounded-2xl bg-danger/10 text-danger font-bold border border-danger/20 hover:bg-danger/20 transition-colors">
                Decline
              </button>
              <button onClick={() => handleAccept(request.id)}
                className="flex-1 btn-primary h-12 rounded-2xl">
                Accept ✅
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Greeting */}
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">
            {getGreeting()}, Dr. {user?.firstName ?? 'Doctor'} 👋
          </h1>
          <p className="text-ink-black/50 text-sm mt-1">Ready to help patients today?</p>
        </div>

        {/* Online toggle */}
        <button
          onClick={toggleOnline}
          className={`flex items-center gap-3 px-5 py-3 rounded-2xl font-montserrat font-bold text-sm transition-all ${
            stats.isOnline
              ? 'bg-success/10 text-success border border-success/20'
              : 'bg-steel-grey/50 text-ink-black/50 border border-steel-grey'
          }`}
        >
          <div className={`w-3 h-3 rounded-full ${stats.isOnline ? 'bg-success animate-pulse' : 'bg-steel-grey'}`} />
          {stats.isOnline ? 'Online · Taking Patients' : 'Go Online'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Consultations', value: stats.totalConsultations, icon: ClipboardList, color: 'from-care-blue to-int-blue' },
          { label: 'Completed Today', value: stats.completedToday, icon: CheckCircle2, color: 'from-teal-green to-emerald-400' },
          { label: 'Rating', value: stats.rating ? `★ ${stats.rating.toFixed(1)}` : 'No reviews', icon: Star, color: 'from-warning to-orange-400' },
          { label: 'Total Earnings', value: `ETB ${stats.earnings.toLocaleString()}`, icon: Wallet, color: 'from-int-blue to-teal-green' },
        ].map(s => (
          <div key={s.label} className="card p-5">
            <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-3`}>
              <s.icon size={18} className="text-white" />
            </div>
            <p className="font-montserrat font-black text-2xl text-ink-black mb-0.5">{loading ? '—' : s.value}</p>
            <p className="text-ink-black/50 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: ClipboardList, label: 'View Consultations', href: '/doctor/consultations', desc: 'Manage all sessions' },
          { icon: Calendar, label: 'My Schedule', href: '/doctor/schedule', desc: 'Set your availability' },
          { icon: User, label: 'Edit Profile', href: '/doctor/profile', desc: 'Update info & pricing' },
        ].map(link => (
          <a key={link.href} href={link.href} className="card card-hover p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-cloud-grey flex items-center justify-center flex-shrink-0">
              <link.icon size={20} className="text-care-blue" />
            </div>
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">{link.label}</p>
              <p className="text-ink-black/50 text-xs">{link.desc}</p>
            </div>
            <span className="ml-auto text-ink-black/30">→</span>
          </a>
        ))}
      </div>
    </div>
  )
}
