'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

interface ServiceStatus {
  label: string
  status: string
  ok: boolean
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
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [healthLoading, setHealthLoading] = useState(true)

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

    fetch('/api/admin/health')
      .then(r => r.json())
      .then(d => { if (d.services) setServices(d.services) })
      .finally(() => setHealthLoading(false))
  }, [])

  const statCards = [
    {
      label: 'Approved Doctors',
      value: stats.totalDoctors,
      icon: '👨‍⚕️',
      color: 'from-care-blue to-int-blue',
      change: loading ? '—' : `+${stats.newDoctorsThisMonth} this month`,
      alert: false,
      href: '/admin/doctors',
    },
    {
      label: 'Pending Approvals',
      value: stats.pendingApprovals,
      icon: '⏳',
      color: 'from-warning to-orange-400',
      change: stats.pendingApprovals > 0 ? 'Needs review' : 'All clear',
      alert: stats.pendingApprovals > 0,
      href: '/admin/approvals',
    },
    {
      label: 'Total Patients',
      value: stats.totalPatients,
      icon: '🧑',
      color: 'from-teal-green to-emerald-400',
      change: loading ? '—' : `+${stats.newPatientsThisWeek} this week`,
      alert: false,
      href: '/admin/patients',
    },
    {
      label: 'Total Consultations',
      value: stats.totalConsultations,
      icon: '📋',
      color: 'from-int-blue to-teal-green',
      change: loading ? '—' : `${stats.completedToday} completed today`,
      alert: false,
      href: '/admin/consultations',
    },
    {
      label: 'Active Right Now',
      value: stats.activeNow,
      icon: '🟢',
      color: 'from-success to-teal-green',
      change: 'Live consultations',
      alert: false,
      href: '/admin/consultations',
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
          <Link
            key={card.label}
            href={card.href}
            className={`card p-5 border transition-all hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${card.alert ? 'border-warning/40 bg-warning/5' : 'border-transparent'}`}
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
          </Link>
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
              <Link
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
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-montserrat font-bold text-lg text-ink-black">Platform Status</h2>
            {!healthLoading && (
              <span className="text-[10px] font-bold text-ink-black/30 uppercase tracking-wider">Live</span>
            )}
          </div>
          {healthLoading ? (
            <div className="flex flex-col gap-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-steel-grey last:border-0 animate-pulse">
                  <div className="h-3 bg-steel-grey rounded w-40" />
                  <div className="h-3 bg-steel-grey rounded w-16" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {services.map(s => (
                <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-steel-grey last:border-0">
                  <span className="text-sm text-ink-black/70">{s.label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${s.ok ? 'bg-success' : 'bg-warning'}`} />
                    <span className={`text-xs font-semibold ${s.ok ? 'text-success' : 'text-warning'}`}>
                      {s.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
