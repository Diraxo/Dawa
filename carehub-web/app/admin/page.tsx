'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

interface DayBucket {
  label: string   // "Mon", "Tue" …
  date: string    // ISO date string
  count: number
}

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
  const [weeklyData, setWeeklyData] = useState<DayBucket[]>([])
  const [csvLoading, setCsvLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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
        supabase.from('consultations').select('id', { count: 'exact', head: true }).in('status', ['active', 'accepted', 'in_progress']),
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

      // Weekly chart data (last 7 days)
      const buckets: DayBucket[] = []
      const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        const next = new Date(d)
        next.setDate(next.getDate() + 1)
        const { count } = await supabase
          .from('consultations')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', d.toISOString())
          .lt('created_at', next.toISOString())
        buckets.push({
          label: dayLabels[d.getDay()],
          date: d.toISOString().split('T')[0],
          count: count ?? 0,
        })
      }
      setWeeklyData(buckets)
    }
    load()

    fetch('/api/admin/health')
      .then(r => r.json())
      .then(d => { if (d.services) setServices(d.services) })
      .finally(() => setHealthLoading(false))
  }, [])

  const exportCsv = async () => {
    setCsvLoading(true)
    try {
      let query = supabase
        .from('consultations')
        .select(`
          id, type, status, created_at, patient_amount, doctor_amount,
          patient:users!patient_id(full_name),
          doctor_profile:doctor_profiles!doctor_id(user:users(full_name))
        `)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString())
      if (dateTo)   query = query.lte('created_at', new Date(dateTo + 'T23:59:59').toISOString())
      const { data } = await query

      const rows = (data ?? []).map((c: any) => ({
        ID: c.id,
        Type: c.type,
        Status: c.status,
        Patient: c.patient?.full_name ?? '',
        Doctor: c.doctor_profile?.user?.full_name ?? '',
        'Patient Amount': c.patient_amount ?? 0,
        'Doctor Amount': c.doctor_amount ?? 0,
        Date: c.created_at ? new Date(c.created_at).toLocaleString() : '',
      }))

      const headers = Object.keys(rows[0] ?? {})
      const csv = [
        headers.join(','),
        ...rows.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(',')),
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `consultations_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setCsvLoading(false)
    }
  }

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

      {/* Weekly chart + CSV export */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-montserrat font-bold text-lg text-ink-black">Consultations — Last 7 Days</h2>
            <p className="text-ink-black/40 text-xs mt-0.5">Daily consultation volume</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue"
            />
            <span className="text-ink-black/40 text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="h-9 px-3 rounded-xl border border-steel-grey text-ink-black/50 text-xs hover:bg-cloud-grey"
              >
                Clear
              </button>
            )}
            <button
              onClick={exportCsv}
              disabled={csvLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-green text-white text-sm font-montserrat font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {csvLoading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <span>⬇</span>
              )}
              Export CSV
            </button>
          </div>
        </div>

        {weeklyData.length === 0 ? (
          <div className="h-32 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-care-blue/30 border-t-care-blue rounded-full animate-spin" />
          </div>
        ) : (() => {
          const maxCount = Math.max(...weeklyData.map(d => d.count), 1)
          return (
            <div className="flex items-end gap-3 h-40 px-2">
              {weeklyData.map((day) => {
                const heightPct = Math.max((day.count / maxCount) * 100, 4)
                const isToday = day.date === new Date().toISOString().split('T')[0]
                return (
                  <div key={day.date} className="flex flex-col items-center gap-1.5 flex-1">
                    <span className="text-xs font-semibold text-ink-black/60">{day.count}</span>
                    <div
                      className={`w-full rounded-t-lg transition-all ${isToday ? 'bg-teal-green' : 'bg-care-blue/30'}`}
                      style={{ height: `${heightPct}%` }}
                      title={`${day.date}: ${day.count} consultations`}
                    />
                    <span className={`text-[11px] font-medium ${isToday ? 'text-teal-green font-bold' : 'text-ink-black/40'}`}>
                      {day.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })()}
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
