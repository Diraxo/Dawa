'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { supabase, getAuthClient } from '@/lib/supabase'
import { useDoctorOnlineStatus } from '@/hooks/useDoctorOnlineStatus'
import { getGreeting, stripDrPrefix } from '@/lib/utils'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, Phone, Video, Stethoscope, CalendarDays } from 'lucide-react'

interface Doctor {
  id: string
  specialty: string
  chat_price: number
  phone_price: number
  video_price: number
  rating_average: number
  is_online: boolean
  languages: string[] | null
  availability: Record<string, unknown> | null
  user: { full_name: string; profile_photo_url: string | null } | null
}

interface UpcomingAppointment {
  id: string
  type: string
  status: string
  scheduled_at: string | null
  doctor: { specialty: string; user: { full_name: string } | null } | null
}

const CONSULT_TYPES = [
  { icon: MessageCircle, label: 'Chat', desc: 'Text messaging', color: 'from-int-blue to-care-blue' },
  { icon: Phone, label: 'Phone', desc: 'Audio call', color: 'from-care-blue to-teal-green' },
  { icon: Video, label: 'Video', desc: 'Video call', color: 'from-teal-green to-emerald-400' },
]

function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

export default function PatientHomePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [onlineDoctors, setOnlineDoctors] = useState<Doctor[]>([])
  const [topDoctors, setTopDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [upcomingAppointment, setUpcomingAppointment] = useState<UpcomingAppointment | null>(null)
  const [ownPhotoUrl, setOwnPhotoUrl] = useState<string | null>(null)
  const [ownUserId, setOwnUserId] = useState<string | null>(null)

  // Fetches both sections. Called on mount, then once more when the realtime
  // channel below reaches SUBSCRIBED — a doctor toggle that fired during the
  // join-latency window (before SUBSCRIBED) is otherwise lost forever, so
  // this reconciliation pass re-reads current state from the DB. Rows are
  // passed through `reconcile` so a fetch that resolves after a live update
  // already applied can't revert it.
  function loadDoctors() {
    Promise.all([
      supabase
        .from('doctor_profiles')
        .select('id, specialty, chat_price, phone_price, video_price, rating_average, is_online, languages, availability, user:users(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .eq('is_online', true)
        .order('rating_average', { ascending: false })
        .limit(8),
      supabase
        .from('doctor_profiles')
        .select('id, specialty, chat_price, phone_price, video_price, rating_average, is_online, languages, availability, user:users(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .order('rating_average', { ascending: false })
        .limit(8),
    ]).then(([onlineRes, topRes]) => {
      const online = ((onlineRes.data ?? []) as unknown as Doctor[]).map(reconcile).filter(d => d.is_online)
      const top = ((topRes.data ?? []) as unknown as Doctor[]).map(reconcile)
      setOnlineDoctors(online)
      setTopDoctors(top)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadDoctors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Real post-booking statuses are 'scheduled' (paid scheduled booking) and
  // 'waiting_for_doctor' (on-demand/activated) — 'pending'/'active' were
  // never actually written by book_appointment_slot(), so this card could
  // never show a freshly booked appointment. Kept live via a `consultations`
  // realtime subscription (below) so booking/rescheduling/cancelling updates
  // this card immediately, matching app/patient/appointments/page.tsx.
  useEffect(() => {
    if (!user) return
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function loadUpcomingAppointment(client: ReturnType<typeof getAuthClient>, patientId: string) {
      const { data } = await client
        .from('consultations')
        .select('id, type, status, scheduled_at, doctor:doctor_profiles!doctor_id(specialty, user:users(full_name))')
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'waiting_for_doctor', 'accepted', 'in_progress', 'active'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
      setUpcomingAppointment(data?.length ? (data[0] as unknown as UpcomingAppointment) : null)
    }

    async function init() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: ud } = await client.from('users').select('id, profile_photo_url').eq('clerk_id', user!.id).single()
      if (!ud) return
      setOwnPhotoUrl((ud as any).profile_photo_url ?? null)
      setOwnUserId((ud as any).id)

      await loadUpcomingAppointment(client, (ud as any).id)

      const topic = `patient-home-upcoming-${(ud as any).id}`
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
      if (stale) supabase.removeChannel(stale)

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'consultations', filter: `patient_id=eq.${(ud as any).id}` },
          async () => {
            const freshToken = await getToken()
            if (!freshToken) return
            await loadUpcomingAppointment(getAuthClient(freshToken), (ud as any).id)
          }
        )
        .subscribe()
    }
    init()
    return () => { if (channel) supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Live-sync the header avatar — a photo change made from another
  // device/session (e.g. mobile, or this patient's own web profile page)
  // should reflect here without a manual reload. ownUserId is set inside
  // loadAppt() above once the users row is fetched.
  useEffect(() => {
    if (!ownUserId) return
    const topic = `own-photo-${ownUserId}`
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
    if (stale) supabase.removeChannel(stale)
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${ownUserId}` },
        (payload) => {
          setOwnPhotoUrl((payload.new as { profile_photo_url: string | null })?.profile_photo_url ?? null)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [ownUserId])

  // Kept current via effect below so the realtime callback (subscribed once,
  // stale-closure-prone) never reads an outdated topDoctors/onlineDoctors.
  const topDoctorsRef = useRef<Doctor[]>([])
  const onlineDoctorsRef = useRef<Doctor[]>([])
  useEffect(() => { topDoctorsRef.current = topDoctors }, [topDoctors])
  useEffect(() => { onlineDoctorsRef.current = onlineDoctors }, [onlineDoctors])

  // Realtime: doctor online/offline status + availability → keep both
  // sections live, no refresh. `onReady` re-runs the initial fetch once the
  // channel is SUBSCRIBED, reconciling anything missed during the join gap.
  const { reconcile } = useDoctorOnlineStatus((doctorId, fields) => {
    setTopDoctors(prev => prev.map(d => d.id === doctorId
      ? { ...d, is_online: fields.is_online, languages: fields.languages ?? d.languages, availability: fields.availability ?? d.availability }
      : d))

    if (!fields.is_online) {
      setOnlineDoctors(prev => prev.filter(d => d.id !== doctorId))
      return
    }

    if (onlineDoctorsRef.current.some(d => d.id === doctorId)) {
      setOnlineDoctors(prev => prev.map(d => d.id === doctorId
        ? { ...d, is_online: true, languages: fields.languages ?? d.languages, availability: fields.availability ?? d.availability }
        : d))
      return
    }

    // A doctor who just went online isn't in onlineDoctors yet (it was
    // fetched with .eq('is_online', true) at page load) — reuse the profile
    // from topDoctors if we already have it, otherwise fetch it fresh.
    // Without this, a doctor who was offline at mount could never appear in
    // "Available Now" until a manual reload.
    const known = topDoctorsRef.current.find(d => d.id === doctorId)
    if (known) {
      setOnlineDoctors(prev => prev.some(d => d.id === doctorId) ? prev : [{ ...known, is_online: true }, ...prev])
      return
    }

    supabase
      .from('doctor_profiles')
      .select('id, specialty, chat_price, phone_price, video_price, rating_average, is_online, languages, availability, user:users(full_name, profile_photo_url)')
      .eq('id', doctorId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setOnlineDoctors(prev =>
          prev.some(d => d.id === doctorId) ? prev : [data as unknown as Doctor, ...prev]
        )
      })
  }, () => { loadDoctors() })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (search.trim()) router.push(`/patient/doctors?q=${encodeURIComponent(search.trim())}`)
    else router.push('/patient/doctors')
  }

  const firstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'there'

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">
            {getGreeting()}, {firstName} 👋
          </h1>
          <p className="text-ink-black/40 text-sm mt-1">{getFormattedDate()}</p>
        </div>
        <Link href="/patient/profile">
          <div className="w-11 h-11 rounded-full bg-gradient-hero flex items-center justify-center text-white font-bold text-base cursor-pointer hover:opacity-90 transition-opacity overflow-hidden">
            {ownPhotoUrl || user?.imageUrl
              ? <img src={ownPhotoUrl || user?.imageUrl} alt="avatar" className="w-full h-full object-cover" />
              : <span>{firstName.charAt(0).toUpperCase()}</span>
            }
          </div>
        </Link>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex items-center gap-2 bg-white rounded-2xl border border-steel-grey px-4 py-3 shadow-sm focus-within:border-int-blue transition-colors">
          <svg width="18" height="18" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search doctors, specialties…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 font-montserrat text-sm text-ink-black bg-transparent outline-none placeholder:text-ink-black/40"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-ink-black/40 hover:text-ink-black text-lg leading-none">×</button>
          )}
        </div>
      </form>

      {/* Quick Actions */}
      <div className="mb-8">
        <p className="font-montserrat font-bold text-lg text-ink-black mb-1">Quick Actions</p>
        <p className="text-ink-black/40 text-sm mb-4">Start a consultation</p>
        <div className="grid grid-cols-3 gap-4">
          {CONSULT_TYPES.map(ct => (
            <Link key={ct.label} href="/patient/doctors"
              className="card card-hover p-5 flex flex-col items-center gap-3 text-center">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${ct.color} flex items-center justify-center`}>
                <ct.icon size={22} className="text-white" />
              </div>
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">{ct.label}</p>
                <p className="text-ink-black/50 text-xs">{ct.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Available Now */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <p className="font-montserrat font-bold text-lg text-ink-black">Available Now</p>
            <div className="w-2.5 h-2.5 rounded-full bg-success" />
          </div>
          <Link href="/patient/doctors" className="text-teal-green text-sm font-semibold hover:underline">See all →</Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="card p-4 h-24 shimmer-bg rounded-3xl" />)}
          </div>
        ) : onlineDoctors.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-3xl mb-2">😔</p>
            <p className="text-ink-black/50 text-sm">No doctors are online right now. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {onlineDoctors.map(d => (
              <DoctorCard key={d.id} doctor={d} />
            ))}
          </div>
        )}
      </div>

      {/* Top Rated Doctors */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="font-montserrat font-bold text-lg text-ink-black">Top Rated Doctors</p>
          <Link href="/patient/doctors" className="text-teal-green text-sm font-semibold hover:underline">See all →</Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="card p-4 h-24 shimmer-bg rounded-3xl" />)}
          </div>
        ) : topDoctors.length === 0 ? (
          <div className="card p-8 text-center">
            <Stethoscope size={28} className="mx-auto mb-2 text-steel-grey" />
            <p className="text-ink-black/50 text-sm">No approved doctors yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {topDoctors.map(d => (
              <DoctorCard key={d.id} doctor={d} />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming Appointment */}
      <div className="mb-2">
        <p className="font-montserrat font-bold text-lg text-ink-black mb-4">Upcoming Appointment</p>
        {upcomingAppointment ? (
          <Link href="/patient/appointments" className="block">
            <div className="rounded-3xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  {upcomingAppointment.type === 'chat' ? <MessageCircle size={20} /> : upcomingAppointment.type === 'phone' ? <Phone size={20} /> : <Video size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm">
                    Consultation with {(upcomingAppointment.doctor as any)?.user?.full_name ?? 'Doctor'}
                  </p>
                  <p className="text-white/70 text-xs mt-0.5">
                    {upcomingAppointment.type} ·{' '}
                    {upcomingAppointment.scheduled_at
                      ? new Date(upcomingAppointment.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                        ' at ' +
                        new Date(upcomingAppointment.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                      : 'On demand'}
                  </p>
                </div>
                <span className="bg-white/20 border border-white/30 px-3 py-1.5 rounded-xl text-xs font-semibold flex-shrink-0">
                  View Details
                </span>
              </div>
            </div>
          </Link>
        ) : (
          <Link href="/patient/doctors" className="block">
            <div className="card p-8 text-center border-2 border-dashed border-steel-grey hover:border-teal-green transition-colors">
              <CalendarDays size={28} className="mx-auto mb-2 text-steel-grey" />
              <p className="font-montserrat font-bold text-base text-ink-black mb-1">No upcoming appointments</p>
              <p className="text-ink-black/50 text-sm">Book a consultation to get started</p>
            </div>
          </Link>
        )}
      </div>
    </div>
  )
}

function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <div className="card card-hover p-4 flex items-center gap-4">
      <div className="relative flex-shrink-0">
        {doctor.user?.profile_photo_url ? (
          <img src={doctor.user.profile_photo_url} alt={doctor.user.full_name ?? ''} className="w-12 h-12 rounded-2xl object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black">
            {stripDrPrefix(doctor.user?.full_name ?? '?').charAt(0)}
          </div>
        )}
        {doctor.is_online && (
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-success border-2 border-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {stripDrPrefix(doctor.user?.full_name ?? '')}</p>
        <p className="text-ink-black/50 text-xs">{doctor.specialty}</p>
        {doctor.languages && doctor.languages.length > 0 && (
          <p className="text-ink-black/40 text-[11px] truncate mt-0.5">{doctor.languages.join(', ')}</p>
        )}
        {doctor.is_online && (
          <div className="flex items-center gap-2 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-success" />
            <span className="text-success text-[10px] font-semibold">Online</span>
          </div>
        )}
      </div>
      <Link
        href={`/patient/doctors/${doctor.id}`}
        className="btn-primary h-9 px-3 text-xs rounded-xl flex-shrink-0"
      >
        Book
      </Link>
    </div>
  )
}
