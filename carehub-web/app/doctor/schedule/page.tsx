'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'

interface ScheduledConsultation {
  id: string
  type: string
  status: string
  started_at: string | null
  created_at: string
  patient_amount: number
  patient: { full_name: string } | null
}

const TYPE_ICONS: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }
const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning',
  active:    'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/15 text-danger',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DoctorSchedulePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [consultations, setConsultations] = useState<ScheduledConsultation[]>([])
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!ud) { setLoading(false); return }

      const { data: dp } = await client
        .from('doctor_profiles')
        .select('id, is_online')
        .eq('user_id', ud.id)
        .single()
      if (!dp) { setLoading(false); return }

      setProfileId(dp.id)
      setIsOnline(dp.is_online ?? false)

      // This week's consultations
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const { data } = await client
        .from('consultations')
        .select('id, type, status, started_at, created_at, patient_amount, patient:users!patient_id(full_name)')
        .eq('doctor_id', dp.id)
        .gte('created_at', weekStart.toISOString())
        .lt('created_at', weekEnd.toISOString())
        .order('created_at', { ascending: true })

      setConsultations((data ?? []) as unknown as ScheduledConsultation[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function toggleOnline() {
    if (!profileId) return
    setToggling(true)
    const token = await getToken()
    if (!token) { setToggling(false); return }
    const client = getAuthClient(token)
    const newStatus = !isOnline
    await client.from('doctor_profiles').update({ is_online: newStatus }).eq('id', profileId)
    setIsOnline(newStatus)
    setToggling(false)
  }

  // Group consultations by weekday index
  const grouped: Record<number, ScheduledConsultation[]> = {}
  consultations.forEach(c => {
    const day = new Date(c.created_at).getDay()
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(c)
  })

  const todayDay = new Date().getDay()

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">My Schedule</h1>
        <p className="text-ink-black/50 text-sm mt-1">This week&apos;s consultations from the database</p>
      </div>

      {/* Online toggle */}
      <div className="card p-5 mb-6 flex items-center justify-between">
        <div>
          <p className="font-montserrat font-bold text-base text-ink-black mb-0.5">Availability Status</p>
          <p className="text-ink-black/50 text-sm">
            {isOnline
              ? 'You are online and visible to patients right now.'
              : 'You are offline. Patients cannot book consultations with you.'}
          </p>
        </div>
        <button
          onClick={toggleOnline}
          disabled={toggling}
          className={`flex items-center gap-3 px-5 py-3 rounded-2xl font-montserrat font-bold text-sm transition-all disabled:opacity-50 ${
            isOnline
              ? 'bg-success/10 text-success border border-success/20'
              : 'bg-steel-grey/50 text-ink-black/50 border border-steel-grey'
          }`}
        >
          <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-steel-grey'}`} />
          {toggling ? '…' : isOnline ? 'Online · Go Offline' : 'Go Online'}
        </button>
      </div>

      {/* Week calendar */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">This Week</h2>
        {loading ? (
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map(d => <div key={d} className="h-24 shimmer-bg rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((day, i) => {
              const daySessions = grouped[i] ?? []
              const isToday = i === todayDay
              return (
                <div key={day} className={`rounded-2xl p-2 min-h-[80px] ${isToday ? 'bg-int-blue/5 border border-int-blue/20' : 'bg-cloud-grey'}`}>
                  <p className={`text-center text-[10px] font-bold uppercase mb-2 ${isToday ? 'text-int-blue' : 'text-ink-black/40'}`}>
                    {day}
                  </p>
                  {daySessions.length === 0 ? (
                    <p className="text-center text-[10px] text-ink-black/20 mt-2">—</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {daySessions.map(s => (
                        <div
                          key={s.id}
                          title={`${s.patient?.full_name ?? 'Patient'} · ${s.type}`}
                          className={`rounded-lg px-1.5 py-1 text-[9px] font-bold truncate ${
                            s.status === 'active' ? 'bg-int-blue text-white'
                            : s.status === 'completed' ? 'bg-success/20 text-success'
                            : s.status === 'cancelled' ? 'bg-danger/10 text-danger'
                            : 'bg-warning/20 text-warning'
                          }`}
                        >
                          {TYPE_ICONS[s.type]} {s.patient?.full_name?.split(' ')[0] ?? 'Patient'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Session list */}
      <div className="card p-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">
          This Week&apos;s Sessions ({consultations.length})
        </h2>
        {loading ? (
          <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="h-16 shimmer-bg rounded-2xl" />)}</div>
        ) : consultations.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-2">📅</p>
            <p className="text-ink-black/50 text-sm">No consultations this week.</p>
            <p className="text-ink-black/40 text-xs mt-1">Go online to start receiving patient requests.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-steel-grey">
            {consultations.map(c => (
              <div key={c.id} className="py-3 flex items-center gap-3">
                <span className="text-xl flex-shrink-0">{TYPE_ICONS[c.type]}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm text-ink-black">{c.patient?.full_name ?? 'Patient'}</p>
                  <p className="text-ink-black/40 text-xs">{formatDateTime(c.started_at ?? c.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status] ?? ''}`}>
                    {c.status}
                  </span>
                  {c.patient_amount > 0 && (
                    <span className="text-xs text-teal-green font-bold">ETB {c.patient_amount}</span>
                  )}
                  {c.status === 'active' && (
                    <Link href={`/doctor/consultation/${c.type}/${c.id}`}
                      className="text-xs font-bold text-int-blue hover:underline">
                      Resume →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
