'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

interface DayAvailability {
  enabled: boolean
  startTime: string  // stored as "09:00 AM" to match the app
  endTime: string
}

interface ScheduledConsultation {
  id: string
  type: string
  status: string
  started_at: string | null
  scheduled_at: string | null
  created_at: string
  patient_amount: number
  patient: { full_name: string } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DEFAULT_AVAILABILITY: Record<DayKey, DayAvailability> = {
  Mon: { enabled: true,  startTime: '09:00 AM', endTime: '05:00 PM' },
  Tue: { enabled: true,  startTime: '09:00 AM', endTime: '05:00 PM' },
  Wed: { enabled: true,  startTime: '09:00 AM', endTime: '05:00 PM' },
  Thu: { enabled: true,  startTime: '09:00 AM', endTime: '05:00 PM' },
  Fri: { enabled: true,  startTime: '09:00 AM', endTime: '05:00 PM' },
  Sat: { enabled: false, startTime: '10:00 AM', endTime: '02:00 PM' },
  Sun: { enabled: false, startTime: '10:00 AM', endTime: '02:00 PM' },
}

const TYPE_ICONS: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning',
  active:    'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/10 text-danger',
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function to24h(t12: string): string {
  const [time, period] = t12.split(' ')
  let [h, m] = time.split(':').map(Number)
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function to12h(t24: string): string {
  const [h, m] = t24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`
}

function formatApptDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return `Today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  if (same(d, tomorrow)) return `Tomorrow · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DoctorSchedulePage() {
  const { user } = useUser()
  const { getToken } = useAuth()

  const [loading, setLoading] = useState(true)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(false)
  const [toggling, setToggling] = useState(false)

  const [acceptScheduled, setAcceptScheduled] = useState(true)
  const [onDemandOnly, setOnDemandOnly] = useState(false)
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)
  const [blockedDates, setBlockedDates] = useState<string[]>([])
  const [blockInput, setBlockInput] = useState('')
  const [blockError, setBlockError] = useState('')
  const [savingAvail, setSavingAvail] = useState(false)
  const [savedAvail, setSavedAvail] = useState(false)

  const [consultations, setConsultations] = useState<ScheduledConsultation[]>([])
  const [selectedDay, setSelectedDay] = useState(new Date().getDay()) // 0=Sun

  // ── Load ───────────────────────────────────────────────────────────────────
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
        .select('id, is_online, availability')
        .eq('user_id', (ud as any).id)
        .single()
      if (!dp) { setLoading(false); return }

      setProfileId((dp as any).id)
      setIsOnline((dp as any).is_online ?? false)
      if ((dp as any).availability) {
        const avail = (dp as any).availability as Record<string, unknown>
        if (typeof avail.acceptScheduled === 'boolean') setAcceptScheduled(avail.acceptScheduled)
        if (typeof avail.onDemandOnly === 'boolean') setOnDemandOnly(avail.onDemandOnly)
        const dayKeys = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
        const dayAvail: Record<string, unknown> = {}
        dayKeys.forEach(k => { if (avail[k]) dayAvail[k] = avail[k] })
        if (Object.keys(dayAvail).length) setAvailability(prev => ({ ...prev, ...dayAvail }))
        if (Array.isArray(avail.blocked_dates)) setBlockedDates(avail.blocked_dates as string[])
      }

      // Load consultations: all active/pending + completed within this week
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const [{ data: activePending }, { data: weekCompleted }] = await Promise.all([
        client
          .from('consultations')
          .select('id, type, status, started_at, scheduled_at, created_at, patient_amount, patient:users!patient_id(full_name)')
          .eq('doctor_id', (dp as any).id)
          .in('status', ['pending', 'active'])
          .order('scheduled_at', { ascending: true }),
        client
          .from('consultations')
          .select('id, type, status, started_at, scheduled_at, created_at, patient_amount, patient:users!patient_id(full_name)')
          .eq('doctor_id', (dp as any).id)
          .in('status', ['completed', 'cancelled'])
          .gte('created_at', weekStart.toISOString())
          .lt('created_at', weekEnd.toISOString())
          .order('created_at', { ascending: true }),
      ])
      const data = [...(activePending ?? []), ...(weekCompleted ?? [])]

      setConsultations((data ?? []) as unknown as ScheduledConsultation[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ── Online toggle ──────────────────────────────────────────────────────────
  async function toggleOnline() {
    if (!profileId) return
    setToggling(true)
    const token = await getToken()
    if (!token) { setToggling(false); return }
    const client = getAuthClient(token)
    const next = !isOnline
    await client.from('doctor_profiles').update({ is_online: next }).eq('id', profileId)
    setIsOnline(next)
    setToggling(false)
  }

  // ── Save availability ──────────────────────────────────────────────────────
  async function saveAvailability() {
    if (!profileId) return
    setSavingAvail(true)
    const token = await getToken()
    if (!token) { setSavingAvail(false); return }
    const client = getAuthClient(token)
    const payload = { ...availability, acceptScheduled, onDemandOnly, blocked_dates: blockedDates }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.from('doctor_profiles').update({ availability: payload as any }).eq('id', profileId)
    setSavingAvail(false)
    setSavedAvail(true)
    setTimeout(() => setSavedAvail(false), 2500)
  }

  // ── Block dates ────────────────────────────────────────────────────────────
  async function addBlockedDate() {
    setBlockError('')
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(blockInput)) { setBlockError('Use YYYY-MM-DD format.'); return }
    const d = new Date(blockInput + 'T12:00:00')
    if (isNaN(d.getTime())) { setBlockError('Invalid date.'); return }
    if (d < new Date(new Date().setHours(0, 0, 0, 0))) { setBlockError('Cannot block past dates.'); return }
    const updated = blockedDates.includes(blockInput) ? blockedDates : [...blockedDates, blockInput]
    setBlockedDates(updated)
    setBlockInput('')
    if (!profileId) return
    const token = await getToken()
    if (!token) return
    const payload = { ...availability, acceptScheduled, onDemandOnly, blocked_dates: updated }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAuthClient(token).from('doctor_profiles').update({ availability: payload as any }).eq('id', profileId)
  }

  async function removeBlockedDate(dateStr: string) {
    const updated = blockedDates.filter(d => d !== dateStr)
    setBlockedDates(updated)
    if (!profileId) return
    const token = await getToken()
    if (!token) return
    const payload = { ...availability, acceptScheduled, onDemandOnly, blocked_dates: updated }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAuthClient(token).from('doctor_profiles').update({ availability: payload as any }).eq('id', profileId)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const grouped: Record<number, ScheduledConsultation[]> = {}
  consultations.forEach(c => {
    const day = new Date(c.created_at).getDay()
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(c)
  })

  const todayDay = new Date().getDay()

  // This week's date numbers for the strip
  const today = new Date()
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - today.getDay() + i)
    return d.getDate()
  })

  // Upcoming appointments (from all consultations with scheduled_at in the future)
  const upcoming = consultations.filter(c =>
    (c.status === 'pending' || c.status === 'active') &&
    (c.scheduled_at ? new Date(c.scheduled_at) >= new Date() : false)
  )

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">My Schedule</h1>
        <p className="text-ink-black/50 text-sm mt-1">Manage your availability and upcoming sessions</p>
      </div>

      {/* ── Mode toggles ── */}
      <div className="card p-5 mb-6 divide-y divide-cloud-grey">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A4598" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <p className="font-montserrat font-semibold text-sm text-ink-black">Accept Scheduled Appointments</p>
              <p className="text-xs text-ink-black/40 mt-0.5">Let patients book in advance</p>
            </div>
          </div>
          <button
            onClick={() => setAcceptScheduled(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors ${acceptScheduled ? 'bg-teal-green' : 'bg-steel-grey'}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${acceptScheduled ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between pt-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2962FF" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div>
              <p className="font-montserrat font-semibold text-sm text-ink-black">On-Demand Only</p>
              <p className="text-xs text-ink-black/40 mt-0.5">Only accept instant consultation requests</p>
            </div>
          </div>
          <button
            onClick={() => setOnDemandOnly(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors ${onDemandOnly ? 'bg-teal-green' : 'bg-steel-grey'}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${onDemandOnly ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* ── Online status ── */}
      <div className="card p-5 mb-6 flex items-center justify-between">
        <div>
          <p className="font-montserrat font-bold text-base text-ink-black mb-0.5">Availability Status</p>
          <p className="text-ink-black/50 text-sm">
            {isOnline ? 'You are online and visible to patients.' : 'You are offline. Patients cannot book with you.'}
          </p>
        </div>
        <button
          onClick={toggleOnline}
          disabled={toggling}
          className={`flex items-center gap-2.5 px-5 py-2.5 rounded-2xl font-montserrat font-bold text-sm transition-all disabled:opacity-50 ${
            isOnline ? 'bg-success/10 text-success border border-success/20' : 'bg-cloud-grey text-ink-black/50 border border-steel-grey'
          }`}
        >
          <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-steel-grey'}`} />
          {toggling ? '…' : isOnline ? 'Online · Go Offline' : 'Go Online'}
        </button>
      </div>

      {/* ── Weekly strip ── */}
      <h2 className="font-montserrat font-bold text-lg text-ink-black mb-3">This Week</h2>
      <div className="flex gap-2 mb-6">
        {WEEK_DAYS.map((day, i) => {
          const isSelected = selectedDay === i
          const isToday = i === todayDay
          const daySessions = grouped[i] ?? []
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(i)}
              className="flex-1 flex flex-col items-center rounded-2xl py-3 transition-all"
              style={isSelected
                ? { background: 'linear-gradient(to bottom, #2962FF, #00BFA5)', color: 'white' }
                : { background: isToday ? '#EFF6FF' : '#F5F7FA', color: '#111827' }
              }
            >
              <p className={`text-[10px] font-bold uppercase mb-1 ${isSelected ? 'text-white/80' : isToday ? 'text-int-blue' : 'text-ink-black/40'}`}>
                {day}
              </p>
              <p className={`font-montserrat font-black text-base ${isSelected ? 'text-white' : 'text-ink-black'}`}>
                {weekDates[i]}
              </p>
              {daySessions.length > 0 && !isSelected && (
                <div className="w-1.5 h-1.5 rounded-full bg-teal-green mt-1" />
              )}
              {isToday && !isSelected && <div className="w-1.5 h-1.5 rounded-full bg-int-blue mt-1" />}
            </button>
          )
        })}
      </div>

      {/* ── Available hours per day ── */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Set Your Available Hours</h2>
        <div className="flex flex-col divide-y divide-cloud-grey">
          {DAYS.map(day => {
            const avail = availability[day]
            return (
              <div key={day} className="flex items-center gap-4 py-3">
                {/* Toggle */}
                <button
                  onClick={() => setAvailability(prev => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))}
                  className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${avail.enabled ? 'bg-teal-green' : 'bg-steel-grey'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${avail.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>

                {/* Day name */}
                <p className={`font-montserrat font-bold text-sm w-9 flex-shrink-0 ${avail.enabled ? 'text-ink-black' : 'text-ink-black/30'}`}>
                  {day}
                </p>

                {/* Hours */}
                {avail.enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={to24h(avail.startTime)}
                      onChange={e => setAvailability(prev => ({
                        ...prev,
                        [day]: { ...prev[day], startTime: to12h(e.target.value) }
                      }))}
                      className="h-9 px-3 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
                    />
                    <span className="text-ink-black/30 text-sm">→</span>
                    <input
                      type="time"
                      value={to24h(avail.endTime)}
                      onChange={e => setAvailability(prev => ({
                        ...prev,
                        [day]: { ...prev[day], endTime: to12h(e.target.value) }
                      }))}
                      className="h-9 px-3 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-ink-black/30 flex-1">Off</p>
                )}
              </div>
            )
          })}
        </div>

        <button
          onClick={saveAvailability}
          disabled={savingAvail}
          className="mt-5 w-full h-[52px] rounded-2xl font-montserrat font-bold text-base text-white disabled:opacity-60 transition-opacity"
          style={{ background: 'linear-gradient(to right, #2962FF, #00BFA5)' }}
        >
          {savingAvail ? 'Saving…' : savedAvail ? '✓ Saved' : 'Save Availability'}
        </button>
      </div>

      {/* ── Upcoming appointments ── */}
      <h2 className="font-montserrat font-bold text-lg text-ink-black mb-3">Upcoming Appointments</h2>
      {loading ? (
        <div className="flex flex-col gap-2 mb-6">
          {[1, 2].map(i => <div key={i} className="h-16 shimmer-bg rounded-2xl" />)}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="card p-10 text-center mb-6">
          <p className="text-3xl mb-2">📅</p>
          <p className="text-ink-black/50 text-sm">No upcoming appointments</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-6">
          {upcoming.map(appt => (
            <div key={appt.id} className="card p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-cloud-grey flex items-center justify-center text-xl flex-shrink-0">
                {TYPE_ICONS[appt.type]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-montserrat font-semibold text-sm text-ink-black">{appt.patient?.full_name ?? 'Patient'}</p>
                <p className="text-xs text-ink-black/40 mt-0.5">{formatApptDate(appt.scheduled_at ?? appt.created_at)}</p>
              </div>
              <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#EFF6FF] text-int-blue flex-shrink-0">
                Upcoming
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── This week's sessions ── */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">
          This Week&apos;s Sessions ({consultations.length})
        </h2>
        {loading ? (
          <div className="flex flex-col gap-3">{[1, 2, 3].map(i => <div key={i} className="h-16 shimmer-bg rounded-2xl" />)}</div>
        ) : consultations.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-2">📅</p>
            <p className="text-ink-black/50 text-sm">No consultations this week.</p>
            <p className="text-ink-black/40 text-xs mt-1">Go online to start receiving patient requests.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-cloud-grey">
            {consultations.map(c => (
              <div key={c.id} className="py-3 flex items-center gap-3">
                <span className="text-xl flex-shrink-0">{TYPE_ICONS[c.type]}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm text-ink-black">{c.patient?.full_name ?? 'Patient'}</p>
                  <p className="text-ink-black/40 text-xs">{formatDateTime((c.started_at ?? c.created_at) as string)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status] ?? ''}`}>
                    {c.status}
                  </span>
                  {c.patient_amount > 0 && (
                    <span className="text-xs text-teal-green font-bold">ETB {c.patient_amount}</span>
                  )}
                  {c.status === 'active' && (
                    <Link href={`/doctor/consultation/${c.type}/${c.id}`} className="text-xs font-bold text-int-blue hover:underline">
                      Resume →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Block dates ── */}
      <div className="card p-5">
        <p className="font-montserrat font-bold text-base text-ink-black mb-1">Blocked Dates</p>
        <p className="text-xs text-ink-black/50 mb-4">Patients cannot book on these dates.</p>

        {blockedDates.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {blockedDates.map(date => (
              <div key={date} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-danger/5 border border-danger/15">
                <span className="font-montserrat font-semibold text-sm text-danger">{date}</span>
                <button
                  onClick={() => removeBlockedDate(date)}
                  className="text-danger/60 hover:text-danger transition-colors p-1"
                  aria-label={`Remove ${date}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1">
            <input
              type="date"
              value={blockInput}
              onChange={e => { setBlockInput(e.target.value); setBlockError('') }}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              className="w-full h-11 px-4 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-danger"
            />
            {blockError && <p className="text-xs text-danger mt-1">{blockError}</p>}
          </div>
          <button
            onClick={addBlockedDate}
            className="h-11 px-5 rounded-xl font-montserrat font-bold text-sm text-white flex items-center gap-2 flex-shrink-0"
            style={{ background: 'linear-gradient(to right, #EF4444, #DC2626)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Block Date
          </button>
        </div>
      </div>
    </div>
  )
}
