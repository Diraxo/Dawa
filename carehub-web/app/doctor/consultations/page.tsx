'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'
import { MessageCircle, Phone, Video, ClipboardList } from 'lucide-react'
import { AppointmentDetailsModal, type AppointmentDetails } from '@/components/doctor/AppointmentDetailsModal'

interface Consultation {
  id: string
  type: string
  status: string
  started_at: string | null
  scheduled_at: string | null
  ended_at: string | null
  created_at: string
  patient_amount: number
  doctor_amount: number
  patient_id: string | null
  patient: { full_name: string; profile_photo_url: string | null } | null
  status_changed_at: string
  doctor_viewed_at: string | null
}

const CONSULTATIONS_SELECT =
  'id, type, status, started_at, scheduled_at, ended_at, created_at, patient_amount, doctor_amount, patient_id, patient:users!patient_id(full_name, profile_photo_url), status_changed_at, doctor_viewed_at'

// Unread = the doctor has never opened the tab this row currently lives in
// since it last changed status. Source of truth: consultations.doctor_viewed_at
// vs. consultations.status_changed_at (see migration 071) — kept identical to
// mobile's isUnread() in app/(doctor)/(tabs)/consultations.tsx.
function isUnread(c: Consultation): boolean {
  return !c.doctor_viewed_at || new Date(c.doctor_viewed_at) < new Date(c.status_changed_at)
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning',
  active:    'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/15 text-danger',
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

// Canonical status → tab-filter bucket, kept identical (in intent) to
// mobile's toStatusBucket() in app/(doctor)/(tabs)/consultations.tsx:
//   pending, waiting_for_doctor          -> 'pending' tab
//   accepted, in_progress, active        -> 'active' tab
//   completed                            -> 'completed' tab
//   cancelled                            -> 'cancelled' tab
//   declined, doctor_missed, no_show,
//   pending_payment                      -> 'other' (not counted under any
//                                           single-status tab — only visible
//                                           via "all", matching mobile's "All"
//                                           tab)
// Tab key strings are unchanged (still 'all' | 'pending' | 'active' |
// 'completed' | 'cancelled') — only row membership now goes through this
// bucket instead of an exact status string match, which previously excluded
// 'waiting_for_doctor' from the Pending tab and 'accepted'/'in_progress' from
// the Active tab, and folded declined/doctor_missed/no_show/pending_payment
// into neither Cancelled tab (mobile, before this fix, wrongly counted them
// as Cancelled — this mismatch is what caused the two platforms' Cancelled
// counts to disagree).
function toFilterBucket(status: string): string {
  if (status === 'pending' || status === 'waiting_for_doctor') return 'pending'
  if (status === 'accepted' || status === 'in_progress' || status === 'active') return 'active'
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  return 'other'
}

function filterMatches(c: Consultation, filter: string): boolean {
  return filter === 'all' || toFilterBucket(c.status) === filter
}

export default function DoctorConsultationsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [detailsAppt, setDetailsAppt] = useState<AppointmentDetails | null>(null)

  // Marks every currently-unread consultation visible under `f` as viewed —
  // clears that filter's badge immediately (locally, and in the DB so
  // mobile and any other session see the same read state without a refresh).
  const markFilterRead = useCallback((f: string, items: Consultation[]) => {
    const unreadIds = items.filter(c => filterMatches(c, f) && isUnread(c)).map(c => c.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setConsultations(prev => prev.map(c => (unreadIds.includes(c.id) ? { ...c, doctor_viewed_at: now } : c)))
    getToken().then(token => {
      if (!token) return
      getAuthClient(token).from('consultations').update({ doctor_viewed_at: now }).in('id', unreadIds).then(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken])

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!ud) return
      const { data: dp } = await client.from('doctor_profiles').select('id').eq('user_id', ud.id).single()
      if (!dp) return
      setProfileId(dp.id)
      const { data } = await client
        .from('consultations')
        .select(CONSULTATIONS_SELECT)
        .eq('doctor_id', dp.id)
        .order('created_at', { ascending: false })
      const items = (data ?? []) as unknown as Consultation[]
      setConsultations(items)
      setLoading(false)
      // The page always mounts fresh on "All" (Issue 1) — opening it means
      // the doctor is now looking at every row, so clear every badge.
      markFilterRead('all', items)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Live-refresh whenever any of this doctor's consultations change (new
  // incoming request, status change, etc.) so filter badges update instantly
  // while the doctor is sitting on this page — no refresh or reopen needed.
  useEffect(() => {
    if (!profileId) return
    const channel = supabase
      .channel(`doctor-consultations-${profileId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${profileId}` },
        async () => {
          const token = await getToken()
          if (!token) return
          const { data } = await getAuthClient(token)
            .from('consultations')
            .select(CONSULTATIONS_SELECT)
            .eq('doctor_id', profileId)
            .order('created_at', { ascending: false })
          if (data) setConsultations(data as unknown as Consultation[])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const handleFilterClick = (f: string) => {
    setFilter(f)
    markFilterRead(f, consultations)
  }

  const filtered = consultations
    .filter(c => filterMatches(c, filter))
    .filter(c => !search.trim() || (c.patient?.full_name ?? '').toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">Consultations</h1>
          <p className="text-ink-black/50 text-sm mt-1">{consultations.length} total sessions</p>
        </div>
        <input
          type="text"
          placeholder="Search patient name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 px-4 rounded-xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/30 focus:outline-none focus:border-int-blue w-56"
        />
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {['all', 'pending', 'active', 'completed', 'cancelled'].map(f => {
          const unreadCount = consultations.filter(c => filterMatches(c, f) && isUnread(c)).length
          return (
            <button key={f} onClick={() => handleFilterClick(f)}
              className={`h-9 px-4 rounded-2xl text-sm font-semibold capitalize transition-colors flex items-center gap-2 ${
                filter === f ? 'bg-gradient-interactive text-white' : 'bg-white border border-steel-grey text-ink-black/60 hover:border-int-blue'
              }`}>
              {f}
              {unreadCount > 0 && (
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  filter === f ? 'bg-white/30 text-white' : 'bg-steel-grey text-ink-black/60'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">{[1, 2, 3].map(i => <div key={i} className="h-20 shimmer-bg rounded-3xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <ClipboardList size={40} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black">No consultations</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(c => {
            const TypeIcon = TYPE_ICONS[c.type] ?? ClipboardList
            const openDetails = () => setDetailsAppt({
              id: c.id, type: c.type, status: c.status,
              patientName: c.patient?.full_name ?? 'Patient', patientPhotoUrl: c.patient?.profile_photo_url,
              whenLabel: formatDateTime(c.started_at ?? c.scheduled_at ?? c.created_at),
              durationMinutes: c.started_at && c.ended_at
                ? Math.max(1, Math.round((new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60000))
                : undefined,
            })
            return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={openDetails}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openDetails() }}
              className="card p-5 flex items-center gap-4 cursor-pointer hover:bg-cloud-grey/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-2xl bg-gradient-interactive flex items-center justify-center flex-shrink-0">
                <TypeIcon size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-montserrat font-bold text-sm text-ink-black">{c.patient?.full_name ?? 'Patient'}</p>
                <p className="text-ink-black/50 text-xs capitalize">{c.type} consultation</p>
                <p className="text-ink-black/40 text-xs">
                  {formatDateTime(c.started_at ?? c.scheduled_at ?? c.created_at)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[c.status] ?? ''}`}>
                  {c.status}
                </span>
                {c.doctor_amount > 0 && (
                  <span className="text-xs font-bold text-teal-green">+ETB {c.doctor_amount}</span>
                )}
                {/* Resume active session */}
                {(c.status === 'active' || c.status === 'accepted' || c.status === 'in_progress') && (
                  <Link
                    href={`/doctor/consultation/${c.type}/${c.id}`}
                    className="btn-primary h-8 px-4 text-xs rounded-xl"
                  >
                    Resume →
                  </Link>
                )}
                {/* View summary for completed */}
                {c.status === 'completed' && (
                  <Link
                    href={`/doctor/consultation/summary/${c.id}`}
                    className="btn-outline h-8 px-4 text-xs rounded-xl"
                  >
                    Summary
                  </Link>
                )}
                {/* Patient history */}
                {c.patient_id && (
                  <Link
                    href={`/doctor/patient/${c.patient_id}`}
                    className="h-8 px-3 rounded-xl bg-cloud-grey text-ink-black/60 text-xs font-semibold hover:bg-steel-grey transition-colors"
                  >
                    History
                  </Link>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}
      <AppointmentDetailsModal appt={detailsAppt} onClose={() => setDetailsAppt(null)} />
    </div>
  )
}
