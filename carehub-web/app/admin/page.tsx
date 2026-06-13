'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Stats {
  totalDoctors: number
  pendingApprovals: number
  totalPatients: number
  totalConsultations: number
  completedToday: number
  activeNow: number
  newDoctorsThisMonth: number
  newPatientsThisWeek: number
}

export default function AdminHomePage() {
  const [stats, setStats] = useState<Stats>({
    totalDoctors: 0,
    pendingApprovals: 0,
    totalPatients: 0,
    totalConsultations: 0,
    completedToday: 0,
    activeNow: 0,
    newDoctorsThisMonth: 0,
    newPatientsThisWeek: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [
        { count: doctors },
        { count: pending },
        { count: patients },
        { count: consultations },
        { count: completedToday },
        { count: activeNow },
        { count: newDoctors },
        { count: newPatients },
      ] = await Promise.all([
        supabase.from('doctor_profiles').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('doctor_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'patient'),
        supabase.from('consultations').select('id', { count: 'exact', head: true }),
        supabase.from('consultations').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', today),
        supabase.from('consultations').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('doctor_profiles').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'patient').gte('created_at', weekStart),
      ])

      setStats({
        totalDoctors: doctors ?? 0,
        pendingApprovals: pending ?? 0,
        totalPatients: patients ?? 0,
        totalConsultations: consultations ?? 0,
        completedToday: completedToday ?? 0,
        activeNow: activeNow ?? 0,
        newDoctorsThisMonth: newDoctors ?? 0,
        newPatientsThisWeek: newPatients ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [])

  const statCards = [
    {
      label: 'Approved Doctors',
      value: stats.totalDoctors,
      icon: '👨‍⚕️',
      color: 'from-care-blue to-int-blue',
      change: loading ? '—' : `+${stats.newDoctorsThisMonth} this month`,
      alert: false,
    },
    {
      label: 'Pending Approvals',
      value: stats.pendingApprovals,
      icon: '⏳',
      color: 'from-warning to-orange-400',
      change: stats.pendingApprovals > 0 ? 'Needs review' : 'All clear',
      alert: stats.pendingApprovals > 0,
    },
    {
      label: 'Total Patients',
      value: stats.totalPatients,
      icon: '🧑',
      color: 'from-teal-green to-emerald-400',
      change: loading ? '—' : `+${stats.newPatientsThisWeek} this week`,
      alert: false,
    },
    {
      label: 'Total Consultations',
      value: stats.totalConsultations,
      icon: '📋',
      color: 'from-int-blue to-teal-green',
      change: loading ? '—' : `${stats.completedToday} completed today`,
      alert: false,
    },
    {
      label: 'Active Right Now',
      value: stats.activeNow,
      icon: '🟢',
      color: 'from-success to-teal-green',
      change: 'Live consultations',
      alert: false,
    },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Dashboard</h1>
        <p className="text-ink-black/50 text-sm mt-1">Welcome back, Admin. Here&apos;s what&apos;s happening.</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {statCards.map(card => (
          <div
            key={card.label}
            className={`card p-5 border ${card.alert ? 'border-warning/40 bg-warning/5' : 'border-transparent'}`}
          >
            <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center text-lg mb-3`}>
              {card.icon}
            </div>
            <div className="font-montserrat font-black text-3xl text-ink-black mb-0.5">
              {loading ? '—' : card.value.toLocaleString()}
            </div>
            <div className="text-ink-black/60 text-xs font-medium">{card.label}</div>
            <div className={`text-[11px] mt-1.5 font-medium ${card.alert ? 'text-warning' : 'text-teal-green'}`}>
              {card.change}
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Quick Actions</h2>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Review Pending Doctor Applications', href: '/admin/approvals', icon: '✅', urgent: stats.pendingApprovals > 0, badge: stats.pendingApprovals },
              { label: 'View All Doctors', href: '/admin/doctors', icon: '👨‍⚕️', urgent: false, badge: 0 },
              { label: 'View All Patients', href: '/admin/patients', icon: '🧑', urgent: false, badge: 0 },
              { label: 'View All Consultations', href: '/admin/consultations', icon: '📋', urgent: false, badge: 0 },
              { label: 'Payments & Withdrawals', href: '/admin/payments', icon: '💰', urgent: false, badge: 0 },
              { label: 'Platform Settings', href: '/admin/settings', icon: '⚙️', urgent: false, badge: 0 },
            ].map(a => (
              <a
                key={a.href}
                href={a.href}
                className={`flex items-center gap-3 p-3 rounded-xl hover:bg-cloud-grey transition-colors ${a.urgent ? 'bg-warning/8 hover:bg-warning/12' : ''}`}
              >
                <span className="text-lg">{a.icon}</span>
                <span className={`font-montserrat text-sm font-medium ${a.urgent ? 'text-ink-black' : 'text-ink-black/80'}`}>
                  {a.label}
                </span>
                {a.urgent && a.badge > 0 && (
                  <span className="ml-auto text-xs font-bold text-warning bg-warning/15 px-2 py-0.5 rounded-full">
                    {a.badge} pending
                  </span>
                )}
                {!a.urgent && <span className="ml-auto text-ink-black/30">→</span>}
              </a>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Platform Status</h2>
          <div className="flex flex-col gap-3">
            {[
              { label: 'Database (Supabase)', status: 'Operational' },
              { label: 'Authentication (Clerk)', status: 'Operational' },
              { label: 'Video Calls (Agora)', status: 'Operational' },
              { label: 'Chat (Stream)', status: 'Operational' },
              { label: 'Push Notifications (FCM)', status: 'Operational' },
            ].map(s => (
              <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-steel-grey last:border-0">
                <span className="text-sm text-ink-black/70">{s.label}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-xs text-success font-semibold">{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
