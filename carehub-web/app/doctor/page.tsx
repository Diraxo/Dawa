'use client'

import { useEffect, useState, useRef } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getAuthClient, supabase } from '@/lib/supabase'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { RealtimeChannel } from '@supabase/supabase-js'
import { getGreeting, stripDrPrefix } from '@/lib/utils'
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
  patientClerkId: string
  amount: number
}

interface TodayAppointment {
  id: string
  type: string
  patientName: string
  time: string
  status: string
}

export default function DoctorHomePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DoctorStats>({
    totalConsultations: 0, completedToday: 0, rating: 0, earnings: 0, isOnline: false, profileId: null, status: ''
  })
  const [loading, setLoading] = useState(true)
  const [todaySchedule, setTodaySchedule] = useState<TodayAppointment[]>([])
  const [request, setRequest] = useState<IncomingRequest | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const shownIds = useRef(new Set<string>())

  useEffect(() => {
    if (!user) return
    loadStats()
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])


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

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [{ count: completedToday }, { data: earningsData }, { data: scheduleData }, { data: waitingData }] = await Promise.all([
      client.from('consultations').select('id', { count: 'exact', head: true })
        .eq('doctor_id', profile.id).eq('status', 'completed').gte('created_at', today.toISOString()),
      client.from('consultations').select('doctor_amount')
        .eq('doctor_id', profile.id).eq('status', 'completed'),
      client.from('consultations')
        .select('id, type, status, scheduled_at, patient:users!patient_id(full_name)')
        .eq('doctor_id', profile.id)
        .in('status', ['pending', 'active', 'waiting_for_doctor', 'accepted', 'in_progress'])
        .gte('scheduled_at', today.toISOString())
        .lt('scheduled_at', tomorrow.toISOString())
        .order('scheduled_at', { ascending: true }),
      client.from('consultations')
        .select('id, type, patient_id, patient_amount')
        .eq('doctor_id', profile.id)
        .eq('status', 'waiting_for_doctor')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: true })
        .limit(1),
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
    setTodaySchedule((scheduleData ?? []).map((c: any) => ({
      id: c.id,
      type: c.type,
      patientName: c.patient?.full_name ?? 'Patient',
      time: c.scheduled_at ? new Date(c.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
      status: c.status,
    })))
    setLoading(false)

    // Populate incoming request on page load so a refresh doesn't lose a waiting patient
    if (waitingData && waitingData.length > 0) {
      const w = waitingData[0]
      if (!shownIds.current.has(w.id)) {
        shownIds.current.add(w.id)
        const { data: pat } = await client.from('users').select('full_name, clerk_id').eq('id', w.patient_id).single()
        setRequest({ id: w.id, type: w.type, patientName: pat?.full_name ?? 'Patient', patientClerkId: pat?.clerk_id ?? '', amount: w.patient_amount ?? 0 })
      }
    }

    if (profile.id) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      channelRef.current = supabase
        .channel(`doctor-home-${profile.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${profile.id}`,
        }, async payload => {
          const c = payload.new as { id: string; type: string; status: string; patient_id: string; patient_amount: number; payment_status: string }
          if (c.status !== 'waiting_for_doctor') return
          if (c.payment_status !== 'paid') return
          if (shownIds.current.has(c.id)) return
          shownIds.current.add(c.id)
          const { data: pat } = await client.from('users').select('full_name, clerk_id').eq('id', c.patient_id).single()
          setRequest({ id: c.id, type: c.type, patientName: pat?.full_name ?? 'Patient', patientClerkId: pat?.clerk_id ?? '', amount: c.patient_amount ?? 0 })
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
    const token = await getToken()
    const type = request?.type ?? 'chat'
    const patientClerkId = request?.patientClerkId ?? ''

    if (token) {
      const client = getAuthClient(token)
      await client.from('consultations').update({ status: 'accepted', started_at: new Date().toISOString() }).eq('id', consultId)
    }

    // For chat consultations, create the Stream channel immediately so the patient
    // can enter without hitting a race condition where the channel doesn't exist yet.
    if (type === 'chat' && user && patientClerkId) {
      try {
        const clerkToken = token ?? await getToken()
        if (clerkToken) {
          const streamToken = await fetchStreamToken(clerkToken)
          const streamCli = getStreamClient()
          if (!streamCli.userID) {
            await streamCli.connectUser(
              { id: user.id, name: user.fullName ?? user.firstName ?? 'Doctor' },
              streamToken,
            )
          }
          const ch = streamCli.channel('messaging', consultId, {
            members: [user.id, patientClerkId],
          })
          await ch.create()
        }
      } catch {
        // channel may already exist — not fatal
      }
    }

    setRequest(null)
    router.push(`/doctor/consultation/${type}/${consultId}`)
  }

  async function handleDecline(id: string) {
    const token = await getToken()
    if (token) {
      const client = getAuthClient(token)
      await client.from('consultations').update({ status: 'declined' }).eq('id', id)
    }
    setRequest(null)
  }

  const isPending = !loading && !!stats.status && stats.status !== 'approved'

  return (
    <div className="p-8 max-w-5xl relative">
      {/* Incoming request overlay — only for approved doctors */}
      {request && stats.status === 'approved' && (
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

            <div className="inline-flex items-center gap-1.5 bg-success/10 text-success border border-success/30 rounded-full px-3 py-1 text-xs font-semibold mb-6">
              ✓ Payment Confirmed
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

      {/* Pending / rejected banner */}
      {isPending && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl mb-6 text-sm font-montserrat border
          ${stats.status === 'rejected'
            ? 'bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]'
            : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'}`}>
          <span className="text-lg shrink-0 mt-0.5">{stats.status === 'rejected' ? '❌' : '⏳'}</span>
          <div>
            <p className="font-bold mb-0.5">
              {stats.status === 'rejected' ? 'Application Not Approved' : 'Account Under Review'}
            </p>
            <p className="opacity-80">
              {stats.status === 'rejected'
                ? 'Your application was not approved. Please contact support to reapply.'
                : 'Your account is being reviewed by our admin team. You cannot perform any actions until you are approved.'}
            </p>
          </div>
        </div>
      )}

      {/* Greeting */}
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">
            {getGreeting()}, Dr. {stripDrPrefix(user?.firstName ?? 'Doctor')} 👋
          </h1>
          <p className="text-ink-black/50 text-sm mt-1">Ready to help patients today?</p>
        </div>

        {/* Online toggle — disabled until approved */}
        <button
          onClick={isPending ? undefined : toggleOnline}
          disabled={isPending}
          title={isPending ? 'Available after admin approval' : undefined}
          className={`flex items-center gap-3 px-5 py-3 rounded-2xl font-montserrat font-bold text-sm transition-all ${
            isPending
              ? 'bg-steel-grey/30 text-ink-black/30 border border-steel-grey cursor-not-allowed'
              : stats.isOnline
                ? 'bg-success/10 text-success border border-success/20'
                : 'bg-steel-grey/50 text-ink-black/50 border border-steel-grey'
          }`}
        >
          <div className={`w-3 h-3 rounded-full ${isPending ? 'bg-steel-grey' : stats.isOnline ? 'bg-success animate-pulse' : 'bg-steel-grey'}`} />
          {isPending ? 'Pending Approval' : stats.isOnline ? 'Online · Taking Patients' : 'Go Online'}
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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

      {/* Today's schedule */}
      <div>
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-3">Today&apos;s Schedule</h2>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2].map(i => <div key={i} className="h-16 shimmer-bg rounded-2xl" />)}
          </div>
        ) : todaySchedule.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-3xl mb-2">📅</p>
            <p className="text-ink-black/40 text-sm">No appointments scheduled for today</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {todaySchedule.map(appt => {
              const typeIcons: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }
              return (
                <div key={appt.id} className="card p-4 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-cloud-grey flex items-center justify-center text-xl flex-shrink-0">
                    {typeIcons[appt.type] ?? '📋'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-montserrat font-semibold text-sm text-ink-black">{appt.patientName}</p>
                    <p className="text-xs text-ink-black/40 mt-0.5">{appt.time} · {appt.type.charAt(0).toUpperCase() + appt.type.slice(1)}</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-teal-green flex-shrink-0" />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
