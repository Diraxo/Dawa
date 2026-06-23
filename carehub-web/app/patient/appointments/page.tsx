'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDateTime, stripDrPrefix } from '@/lib/utils'
import Link from 'next/link'

interface Appointment {
  id: string
  type: string
  status: string
  payment_status: string
  scheduled_at: string | null
  created_at: string
  patient_amount: number
  doctor_id: string | null
  doctor: { id: string; specialty: string; user: { full_name: string; profile_photo_url: string | null } | null } | null
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning',
  active:    'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/15 text-danger',
}

const TYPE_ICONS: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }

// On-demand bookings have a non-zero seconds component on scheduled_at
function isOnDemand(scheduledAt: string | null): boolean {
  if (!scheduledAt) return true
  const s = new Date(scheduledAt)
  return s.getSeconds() !== 0 || s.getMilliseconds() !== 0
}

export default function AppointmentsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!userData) return
      const { data } = await client
        .from('consultations')
        .select('id, type, status, payment_status, scheduled_at, created_at, patient_amount, doctor_id, doctor:doctor_profiles!doctor_id(id, specialty, user:users(full_name, profile_photo_url))')
        .eq('patient_id', userData.id)
        .order('scheduled_at', { ascending: false })
      setAppointments((data ?? []) as unknown as Appointment[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const now = new Date()

  const filtered = appointments.filter(a => {
    if (tab === 'upcoming') {
      if (a.status === 'active') return true
      // Only show paid-pending scheduled future slots
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
  })

  function joinHref(a: Appointment) {
    return `/patient/consultation/${a.type}/${a.id}`
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Appointments</h1>
        <p className="text-ink-black/50 text-sm mt-1">Track all your consultations</p>
      </div>

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
          <p className="text-5xl mb-3">📅</p>
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

            return (
              <div key={a.id} className="card p-5 flex items-center gap-4">
                {/* Doctor avatar */}
                <div className="w-12 h-12 rounded-2xl flex-shrink-0 overflow-hidden">
                  {photoUrl ? (
                    <img src={photoUrl} alt={doctorName} className="w-12 h-12 object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-base">
                      {stripDrPrefix(doctorName).charAt(0) || '?'}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm text-ink-black">
                    Dr. {stripDrPrefix(doctorName || '—')}
                  </p>
                  <p className="text-ink-black/50 text-xs">{a.doctor?.specialty}</p>
                  <p className="text-ink-black/40 text-xs mt-0.5">
                    {formatDateTime(a.scheduled_at ?? a.created_at)}
                  </p>
                </div>

                {/* Right side */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{TYPE_ICONS[a.type]}</span>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                  </div>
                  {a.patient_amount > 0 && (
                    <span className="text-xs font-bold text-ink-black/60">ETB {a.patient_amount}</span>
                  )}

                  {/* Action buttons */}
                  {a.status === 'active' && (
                    <Link href={joinHref(a)} className="btn-primary h-8 px-4 text-xs rounded-xl">
                      Join Now →
                    </Link>
                  )}
                  {a.status === 'pending' && !isOnDemand(a.scheduled_at) && (
                    <Link href={`/patient/waiting/${a.id}`} className="btn-outline h-8 px-4 text-xs rounded-xl">
                      Waiting Room
                    </Link>
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
    </div>
  )
}
