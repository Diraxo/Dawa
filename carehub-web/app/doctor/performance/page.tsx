'use client'

import { useEffect, useState } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

interface PerfStats {
  totalConsultations: number
  completedConsultations: number
  missedConsultations: number
  declinedConsultations: number
  acceptedConsultations: number
  avgDurationMinutes: number
  avgResponseSeconds: number
  totalRevenue: number
  avgRating: number
  reviewCount: number
  completionRate: number
  acceptanceRate: number
}

interface DayBucket { label: string; count: number; date: string }

const EMPTY: PerfStats = {
  totalConsultations: 0, completedConsultations: 0, missedConsultations: 0,
  declinedConsultations: 0, acceptedConsultations: 0,
  avgDurationMinutes: 0, avgResponseSeconds: 0, totalRevenue: 0,
  avgRating: 0, reviewCount: 0, completionRate: 0, acceptanceRate: 0,
}

function BarChart({ data, color = '#00BFA5' }: { data: DayBucket[]; color?: string }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-2 h-28 px-1">
      {data.map(d => {
        const pct = Math.max((d.count / max) * 100, 4)
        const isToday = d.date === new Date().toISOString().split('T')[0]
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 flex-1 group">
            <span className="text-[10px] font-bold text-ink-black/50 opacity-0 group-hover:opacity-100 transition-opacity">{d.count}</span>
            <div
              className="w-full rounded-t-lg transition-all duration-300"
              style={{ height: `${pct}%`, background: isToday ? color : `${color}55` }}
              title={`${d.date}: ${d.count}`}
            />
            <span className={`text-[10px] font-medium ${isToday ? 'font-bold' : 'text-ink-black/40'}`}
              style={{ color: isToday ? color : undefined }}>
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'text-ink-black' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="card p-5">
      <p className={`font-montserrat font-black text-3xl ${color} leading-none mb-1`}>{value}</p>
      <p className="text-ink-black/70 text-sm font-montserrat font-semibold">{label}</p>
      {sub && <p className="text-ink-black/40 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

export default function DoctorPerformancePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [stats, setStats] = useState<PerfStats>(EMPTY)
  const [daily, setDaily] = useState<DayBucket[]>([])
  const [weekly, setWeekly] = useState<DayBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [doctorId, setDoctorId] = useState<string | null>(null)

  async function load(from?: string, to?: string) {
    if (!user) return
    setLoading(true)
    const token = await getToken()
    if (!token) { setLoading(false); return }
    const client = getAuthClient(token)

    const { data: ud } = await client.from('users').select('id').eq('clerk_id', user.id).single()
    if (!ud) { setLoading(false); return }

    const { data: dp } = await client
      .from('doctor_profiles')
      .select('id, rating_average, review_count')
      .eq('user_id', (ud as any).id)
      .single()
    if (!dp) { setLoading(false); return }

    const dpId = (dp as any).id
    setDoctorId(dpId)

    let query = client
      .from('consultations')
      .select('id, status, duration_minutes, started_at, created_at, doctor_amount, payment_status')
      .eq('doctor_id', dpId)
      .eq('payment_status', 'paid')

    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to)   query = query.lte('created_at', new Date(to + 'T23:59:59').toISOString())

    const { data: consultations } = await query

    const rows = (consultations ?? []) as any[]
    const total = rows.length
    const completed = rows.filter(r => r.status === 'completed').length
    const missed = rows.filter(r => r.status === 'doctor_missed').length
    const declined = rows.filter(r => r.status === 'declined').length
    const accepted = rows.filter(r => !['pending', 'cancelled', 'declined'].includes(r.status)).length
    const revenue = rows.filter(r => r.status === 'completed').reduce((s: number, r: any) => s + Number(r.doctor_amount ?? 0), 0)
    const durations = rows.filter(r => r.duration_minutes && r.status === 'completed').map((r: any) => r.duration_minutes as number)
    const avgDur = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
    const acceptanceRate = (accepted + declined) > 0 ? Math.round((accepted / (accepted + declined)) * 100) : 0

    setStats({
      totalConsultations: total,
      completedConsultations: completed,
      missedConsultations: missed,
      declinedConsultations: declined,
      acceptedConsultations: accepted,
      avgDurationMinutes: avgDur,
      avgResponseSeconds: 0,
      totalRevenue: revenue,
      avgRating: Number((dp as any).rating_average ?? 0),
      reviewCount: Number((dp as any).review_count ?? 0),
      completionRate,
      acceptanceRate,
    })

    // Daily chart (last 14 days)
    const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const dailyBuckets: DayBucket[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const count = rows.filter((r: any) => r.created_at?.startsWith(dateStr)).length
      dailyBuckets.push({ label: dayLabels[d.getDay()], date: dateStr, count })
    }
    setDaily(dailyBuckets)

    // Weekly buckets (last 8 weeks)
    const weeklyBuckets: DayBucket[] = []
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - i * 7 - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)
      const count = rows.filter((r: any) => {
        const d = new Date(r.created_at)
        return d >= weekStart && d < weekEnd
      }).length
      weeklyBuckets.push({
        label: `W${8 - i}`,
        date: weekStart.toISOString().split('T')[0],
        count,
      })
    }
    setWeekly(weeklyBuckets)
    setLoading(false)
  }

  useEffect(() => { load(dateFrom, dateTo) }, [user])

  function applyFilter() { load(dateFrom, dateTo) }
  function clearFilter() { setDateFrom(''); setDateTo(''); load() }

  const formatRevenue = (n: number) => `ETB ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">Performance</h1>
          <p className="text-ink-black/50 text-sm mt-1">Your consultation analytics and patient satisfaction metrics</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue"
          />
          <span className="text-ink-black/40 text-xs">to</span>
          <input
            type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue"
          />
          <button onClick={applyFilter} className="h-9 px-4 rounded-xl bg-teal-green text-white text-xs font-montserrat font-semibold hover:opacity-90 transition-opacity">
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button onClick={clearFilter} className="h-9 px-3 rounded-xl border border-steel-grey text-ink-black/50 text-xs hover:bg-cloud-grey">
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 shimmer-bg rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Consultations" value={stats.totalConsultations} sub="Total (paid)" color="text-care-blue" />
            <StatCard label="Completed" value={stats.completedConsultations} color="text-teal-green" />
            <StatCard label="Missed" value={stats.missedConsultations} color="text-warning" />
            <StatCard label="Declined" value={stats.declinedConsultations} color="text-danger" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Completion Rate" value={`${stats.completionRate}%`}
              sub="completed / total" color={stats.completionRate >= 80 ? 'text-teal-green' : 'text-warning'} />
            <StatCard label="Acceptance Rate" value={`${stats.acceptanceRate}%`}
              sub="accepted / (accepted+declined)" color={stats.acceptanceRate >= 80 ? 'text-teal-green' : 'text-warning'} />
            <StatCard label="Avg Duration" value={stats.avgDurationMinutes > 0 ? `${stats.avgDurationMinutes} min` : '—'}
              sub="completed sessions only" />
            <StatCard label="Revenue" value={formatRevenue(stats.totalRevenue)} sub="doctor share" color="text-care-blue" />
          </div>

          {/* Rating */}
          <div className="card p-6 mb-6 flex items-center gap-6">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
            >
              <span className="font-montserrat font-black text-3xl">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—'}</span>
            </div>
            <div>
              <p className="font-montserrat font-bold text-xl text-ink-black">Patient Satisfaction</p>
              <div className="flex items-center gap-1 mt-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={`text-xl ${i < Math.round(stats.avgRating) ? 'text-yellow-400' : 'text-steel-grey'}`}>★</span>
                ))}
                <span className="text-ink-black/40 text-sm ml-2">{stats.reviewCount} {stats.reviewCount === 1 ? 'review' : 'reviews'}</span>
              </div>
              {stats.avgRating >= 4.5 && <p className="text-teal-green text-xs font-semibold mt-1">Excellent — Top performer</p>}
              {stats.avgRating >= 4 && stats.avgRating < 4.5 && <p className="text-teal-green text-xs font-semibold mt-1">Very Good</p>}
              {stats.avgRating >= 3 && stats.avgRating < 4 && <p className="text-warning text-xs font-semibold mt-1">Good — Room for improvement</p>}
              {stats.avgRating > 0 && stats.avgRating < 3 && <p className="text-danger text-xs font-semibold mt-1">Needs improvement</p>}
            </div>
          </div>

          {/* Daily chart */}
          <div className="card p-6 mb-6">
            <h2 className="font-montserrat font-bold text-base text-ink-black mb-1">Daily Consultations</h2>
            <p className="text-ink-black/40 text-xs mb-4">Last 14 days</p>
            <BarChart data={daily} color="#00BFA5" />
          </div>

          {/* Weekly chart */}
          <div className="card p-6">
            <h2 className="font-montserrat font-bold text-base text-ink-black mb-1">Weekly Consultations</h2>
            <p className="text-ink-black/40 text-xs mb-4">Last 8 weeks</p>
            <BarChart data={weekly} color="#1A4598" />
          </div>
        </>
      )}
    </div>
  )
}
