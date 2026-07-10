'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { writeDoctorOnlineStatus } from '@/lib/doctorOnline'
import { getGreeting, stripDrPrefix } from '@/lib/utils'
import { ClipboardList, CheckCircle2, Star, Wallet, Calendar, User, XCircle, Clock, Ban, MessageCircle, Phone, Video } from 'lucide-react'

interface DoctorStats {
  totalConsultations: number
  completedToday: number
  rating: number
  earnings: number
  isOnline: boolean
  profileId: string | null
  status: string
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
  const [stats, setStats] = useState<DoctorStats>({
    totalConsultations: 0, completedToday: 0, rating: 0, earnings: 0, isOnline: false, profileId: null, status: ''
  })
  const [loading, setLoading] = useState(true)
  const [todaySchedule, setTodaySchedule] = useState<TodayAppointment[]>([])

  useEffect(() => {
    if (!user) return
    loadStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // is_online is one shared state across Home, Schedule, and any other
  // client (mobile, another tab) — without this the toggle here only ever
  // updated local state, so it silently drifted out of sync with whatever
  // the Schedule page (or another session) last wrote to the DB until this
  // page was reloaded.
  useEffect(() => {
    if (!stats.profileId) return
    const channel = supabase
      .channel(`doctor-home-online-${stats.profileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${stats.profileId}` },
        (payload) => {
          const isOnline = (payload.new as { is_online?: boolean })?.is_online
          if (typeof isOnline === 'boolean') setStats(prev => ({ ...prev, isOnline }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [stats.profileId])

  // Live-refresh Today's Schedule whenever any of this doctor's
  // consultations change (new scheduled booking, reschedule, cancellation) —
  // without this the page only ever loaded schedule once, on mount.
  useEffect(() => {
    if (!stats.profileId) return
    const channel = supabase
      .channel(`doctor-home-schedule-${stats.profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${stats.profileId}` },
        async () => {
          const token = await getToken()
          if (!token) return
          await loadTodaySchedule(getAuthClient(token), stats.profileId!)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.profileId])

  async function loadTodaySchedule(client: ReturnType<typeof getAuthClient>, doctorProfileId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const { data: scheduleData } = await client
      .from('consultations')
      .select('id, type, status, scheduled_at, patient:users!patient_id(full_name)')
      .eq('doctor_id', doctorProfileId)
      .in('status', ['pending', 'active', 'waiting_for_doctor', 'accepted', 'in_progress', 'scheduled'])
      .gte('scheduled_at', today.toISOString())
      .lt('scheduled_at', tomorrow.toISOString())
      .order('scheduled_at', { ascending: true })

    setTodaySchedule((scheduleData ?? []).map((c: any) => ({
      id: c.id,
      type: c.type,
      patientName: c.patient?.full_name ?? 'Patient',
      time: c.scheduled_at ? new Date(c.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
      status: c.status,
    })))
  }

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

    const [{ count: completedToday }, { data: earningsData }] = await Promise.all([
      client.from('consultations').select('id', { count: 'exact', head: true })
        .eq('doctor_id', profile.id).eq('status', 'completed').gte('created_at', today.toISOString()),
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
    await loadTodaySchedule(client, profile.id)
    setLoading(false)
  }

  async function toggleOnline() {
    if (!stats.profileId) return
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    const newStatus = !stats.isOnline
    await writeDoctorOnlineStatus(client, stats.profileId, newStatus)
    setStats(prev => ({ ...prev, isOnline: newStatus }))
  }

  const isPending = !loading && !!stats.status && stats.status !== 'approved'

  return (
    <div className="p-8 max-w-5xl relative">
      {/* Pending / rejected banner */}
      {isPending && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl mb-6 text-sm font-montserrat border
          ${stats.status === 'rejected' || stats.status === 'suspended'
            ? 'bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]'
            : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'}`}>
          <span className="shrink-0 mt-0.5">
            {stats.status === 'rejected' ? <XCircle size={20} /> : stats.status === 'suspended' ? <Ban size={20} /> : <Clock size={20} />}
          </span>
          <div>
            <p className="font-bold mb-0.5">
              {stats.status === 'rejected' ? 'Application Not Approved' : stats.status === 'suspended' ? 'Account Suspended' : 'Account Under Review'}
            </p>
            <p className="opacity-80">
              {stats.status === 'rejected'
                ? 'Your application was not approved. Please contact support to reapply.'
                : stats.status === 'suspended'
                ? 'Your account has been suspended. Please contact support.'
                : 'Your account is being reviewed by our admin team. You cannot perform any actions until you are approved.'}
            </p>
          </div>
        </div>
      )}

      {/* Greeting */}
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">
            {getGreeting()}, Dr. {stripDrPrefix(user?.firstName ?? 'Doctor')}
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
            <Calendar size={28} className="mx-auto mb-2 text-steel-grey" />
            <p className="text-ink-black/40 text-sm">No appointments scheduled for today</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {todaySchedule.map(appt => {
              const typeIcons: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }
              const ApptIcon = typeIcons[appt.type] ?? ClipboardList
              return (
                <div key={appt.id} className="card p-4 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-cloud-grey flex items-center justify-center flex-shrink-0">
                    <ApptIcon size={20} className="text-ink-black/60" />
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
