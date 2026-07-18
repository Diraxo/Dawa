'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { formatDateTime, stripDrPrefix } from '@/lib/utils'
import { RescheduleModal, type RescheduleAppointment } from '@/components/patient/RescheduleModal'
import Link from 'next/link'
import { MessageCircle, Phone, Video, Bell, CalendarDays } from 'lucide-react'

interface Appointment {
  id: string
  type: string
  status: string
  payment_status: string
  scheduled_at: string | null
  started_at: string | null
  created_at: string
  patient_amount: number
  doctor_id: string | null
  doctor: { id: string; specialty: string; user: { full_name: string; profile_photo_url: string | null } | null } | null
}

interface FollowupReminder {
  id: string
  remind_at: string
  message: string | null
  consultation_id: string
  doctor: { specialty: string; user: { full_name: string } | null } | null
}

const STATUS_COLORS: Record<string, string> = {
  pending:            'bg-warning/15 text-warning',
  scheduled:          'bg-warning/15 text-warning',
  waiting_for_doctor: 'bg-int-blue/15 text-int-blue',
  active:             'bg-int-blue/15 text-int-blue',
  accepted:           'bg-int-blue/15 text-int-blue',
  in_progress:        'bg-int-blue/15 text-int-blue',
  completed:          'bg-success/15 text-success',
  cancelled:          'bg-danger/15 text-danger',
}

const STATUS_LABELS: Record<string, string> = {
  scheduled:          'Scheduled',
  waiting_for_doctor:  'Entering waiting room…',
}

// Consultation is live (or the doctor has accepted and is about to be) —
// the patient can rejoin. 'active' is kept for back-compat even though no
// current write path sets it; real rows use 'accepted'/'in_progress'.
const JOINABLE_STATUSES = new Set(['active', 'accepted', 'in_progress'])

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

// On-demand bookings have a non-zero seconds component on scheduled_at
function isOnDemand(scheduledAt: string | null): boolean {
  if (!scheduledAt) return true
  const s = new Date(scheduledAt)
  return s.getSeconds() !== 0 || s.getMilliseconds() !== 0
}

export default function AppointmentsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const searchParams = useSearchParams()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [reminders, setReminders] = useState<FollowupReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'past'>(searchParams.get('tab') === 'past' ? 'past' : 'upcoming')

  // Navigating in from elsewhere in the app (e.g. "Back to Appointments"
  // after submitting a review) with a new ?tab= while this page is already
  // mounted needs an explicit sync — the useState initializer above only
  // wins on first mount.
  useEffect(() => {
    const paramTab = searchParams.get('tab')
    if (paramTab === 'past' || paramTab === 'upcoming') setTab(paramTab)
  }, [searchParams])
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null)
  const myUserIdRef = useRef<string | null>(null)
  const [patientId, setPatientId] = useState<string | null>(null)

  async function loadAppointments(client: ReturnType<typeof getAuthClient>, patientId: string) {
    const [{ data }, { data: reminderData }] = await Promise.all([
      client
        .from('consultations')
        .select('id, type, status, payment_status, scheduled_at, started_at, created_at, patient_amount, doctor_id, doctor:doctor_profiles!doctor_id(id, specialty, user:users(full_name, profile_photo_url))')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false }),
      client
        .from('followup_reminders')
        .select('id, remind_at, message, consultation_id, doctor:doctor_profiles!doctor_id(specialty, user:users(full_name))')
        .eq('patient_id', patientId)
        .eq('sent', false)
        .gte('remind_at', new Date().toISOString())
        .order('remind_at', { ascending: true })
        .limit(5),
    ])
    setAppointments((data ?? []) as unknown as Appointment[])
    setReminders((reminderData ?? []) as unknown as FollowupReminder[])
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!userData) return
      myUserIdRef.current = userData.id
      setPatientId(userData.id)
      await loadAppointments(client, userData.id)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // This page previously had no auto-refresh mechanism at all — a booking,
  // reschedule, or status change made elsewhere (or by a cron job, e.g. the
  // scheduled->waiting_for_doctor activation) required a manual page reload
  // to appear. Live-refresh whenever this patient's consultations change.
  useEffect(() => {
    if (!patientId) return
    const channel = supabase
      .channel(`patient-appointments-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `patient_id=eq.${patientId}` },
        async () => {
          const token = await getToken()
          if (!token) return
          await loadAppointments(getAuthClient(token), patientId)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  const now = new Date()

  const filtered = appointments.filter(a => {
    if (tab === 'upcoming') {
      if (JOINABLE_STATUSES.has(a.status)) return true
      if (a.status === 'scheduled') return true
      // Server-time cron activated it (scheduled_at reached) but the doctor
      // hasn't accepted yet — without this branch the row vanished entirely
      // for that window instead of showing "Entering waiting room…".
      if (a.status === 'waiting_for_doctor' && !isOnDemand(a.scheduled_at)) return true
      // Legacy: paid-pending scheduled future slots
      if (a.status === 'pending' && a.payment_status === 'paid' && !isOnDemand(a.scheduled_at)) {
        return a.scheduled_at ? new Date(a.scheduled_at) > now : false
      }
      return false
    } else {
      if (a.status === 'completed') return true
      // Cancelled shows as past ONLY when payment was already confirmed —
      // payment-failure cancellations (payment_status='pending') are hidden
      if (a.status === 'cancelled' && a.payment_status === 'paid') return true
      // Paid-pending scheduled slots whose time has passed
      if (a.status === 'pending' && a.payment_status === 'paid' && !isOnDemand(a.scheduled_at)) {
        return a.scheduled_at ? new Date(a.scheduled_at) <= now : false
      }
      return false
    }
  // The base query orders descending (most-recent-first, right for "past");
  // "upcoming" needs the opposite — nearest day/time first, not furthest-future-first.
  }).sort((a, b) => {
    if (tab !== 'upcoming') return 0
    const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0
    const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0
    return at - bt
  })

  function handleReschedule(a: Appointment) {
    setRescheduleTarget(a)
  }

  function joinHref(a: Appointment) {
    return `/patient/consultation/${a.type}/${a.id}`
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Appointments</h1>
        <p className="text-ink-black/50 text-sm mt-1">Track all your consultations</p>
      </div>

      {/* Follow-up reminders */}
      {reminders.length > 0 && (
        <div className="mb-6">
          <h2 className="font-montserrat font-bold text-base text-ink-black mb-3 flex items-center gap-2">
            <Bell size={18} /> Upcoming Reminders
          </h2>
          <div className="flex flex-col gap-2">
            {reminders.map(r => {
              const doctorName = r.doctor?.user?.full_name ?? 'your doctor'
              const dt = new Date(r.remind_at)
              const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={r.id} className="flex items-start gap-3 bg-teal-green/8 border border-teal-green/20 rounded-2xl px-4 py-3">
                  <CalendarDays size={20} className="mt-0.5 text-teal-green" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-ink-black">
                      {r.message || `Follow-up reminder from Dr. ${stripDrPrefix(doctorName)}`}
                    </p>
                    <p className="text-xs text-ink-black/50 mt-0.5">{dateStr} at {timeStr}</p>
                  </div>
                  <Link
                    href={`/patient/summary/${r.consultation_id}`}
                    className="text-xs font-semibold text-teal-green whitespace-nowrap hover:underline"
                  >
                    View →
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['upcoming', 'past'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-10 px-5 rounded-2xl text-sm font-semibold capitalize transition-colors ${
              tab === t ? 'bg-gradient-interactive text-white' : 'bg-white border border-steel-grey text-ink-black/60'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 shimmer-bg rounded-3xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <CalendarDays size={48} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black mb-1">
            No {tab} appointments
          </p>
          <p className="text-ink-black/50 text-sm mb-6">
            {tab === 'upcoming' ? 'Book a consultation to get started.' : 'Your past consultations will appear here.'}
          </p>
          {tab === 'upcoming' && (
            <Link href="/patient/doctors" className="btn-primary inline-flex h-10 px-6 text-sm rounded-xl">
              Find a Doctor →
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(a => {
            const doctorName = a.doctor?.user?.full_name ?? ''
            const photoUrl = a.doctor?.user?.profile_photo_url
            const TypeIcon = TYPE_ICONS[a.type]

            const doctorHref = a.doctor?.id ? `/patient/doctors/${a.doctor.id}` : undefined

            return (
              <div key={a.id} className="card p-5 flex items-center gap-4">
                {/* Doctor avatar + info — clickable through to the doctor's profile */}
                <Link
                  href={doctorHref ?? '#'}
                  className={`flex items-center gap-4 flex-1 min-w-0 ${doctorHref ? '' : 'pointer-events-none'}`}
                >
                  <div className="w-12 h-12 rounded-2xl flex-shrink-0 overflow-hidden">
                    {photoUrl ? (
                      <img src={photoUrl} alt={doctorName} className="w-12 h-12 object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-base">
                        {stripDrPrefix(doctorName).charAt(0) || '?'}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-montserrat font-bold text-sm text-ink-black">
                      Dr. {stripDrPrefix(doctorName || '—')}
                    </p>
                    <p className="text-ink-black/50 text-xs">{a.doctor?.specialty}</p>
                    <p className="text-ink-black/40 text-xs mt-0.5">
                      {formatDateTime(a.started_at ?? a.scheduled_at ?? a.created_at)}
                    </p>
                  </div>
                </Link>

                {/* Right side */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    {TypeIcon && <TypeIcon size={16} className="text-ink-black/50" />}
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[a.status] ?? ''}`}>
                      {STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </div>
                  {a.patient_amount > 0 && (
                    <span className="text-xs font-bold text-ink-black/60">ETB {a.patient_amount}</span>
                  )}

                  {/* Action buttons */}
                  {JOINABLE_STATUSES.has(a.status) && (
                    <Link href={joinHref(a)} className="btn-primary h-8 px-4 text-xs rounded-xl">
                      Join Now →
                    </Link>
                  )}
                  {a.status === 'waiting_for_doctor' && !isOnDemand(a.scheduled_at) && (
                    <Link href={`/patient/waiting/${a.id}`} className="btn-outline h-8 px-4 text-xs rounded-xl">
                      Waiting Room
                    </Link>
                  )}
                  {a.status === 'pending' && !isOnDemand(a.scheduled_at) && (
                    <div className="flex gap-2">
                      <Link href={`/patient/waiting/${a.id}`} className="btn-outline h-8 px-4 text-xs rounded-xl">
                        Waiting Room
                      </Link>
                      <button
                        onClick={() => handleReschedule(a)}
                        className="h-8 px-4 text-xs rounded-xl border border-warning text-warning font-semibold hover:bg-warning/5 transition-colors"
                      >
                        Reschedule
                      </button>
                    </div>
                  )}
                  {a.status === 'scheduled' && (
                    <button
                      onClick={() => handleReschedule(a)}
                      className="h-8 px-4 text-xs rounded-xl border border-warning text-warning font-semibold hover:bg-warning/5 transition-colors"
                    >
                      Reschedule
                    </button>
                  )}
                  {a.status === 'completed' && (
                    <div className="flex gap-2">
                      <Link href={`/patient/summary/${a.id}`} className="btn-outline h-8 px-4 text-xs rounded-xl">
                        View Summary
                      </Link>
                      <Link
                        href={a.doctor?.id ? `/patient/doctors/${a.doctor.id}` : '/patient/doctors'}
                        className="btn-primary h-8 px-4 text-xs rounded-xl"
                      >
                        Book Again
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <RescheduleModal
        appointment={rescheduleTarget ? {
          id: rescheduleTarget.id,
          doctorId: rescheduleTarget.doctor_id ?? '',
          doctorName: rescheduleTarget.doctor?.user?.full_name ?? 'your doctor',
          type: rescheduleTarget.type,
          scheduledAt: rescheduleTarget.scheduled_at ?? '',
        } as RescheduleAppointment : null}
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => setRescheduleTarget(null)}
      />
    </div>
  )
}
