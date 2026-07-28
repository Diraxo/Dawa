'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDoctorOnlineStatus } from '@/hooks/useDoctorOnlineStatus'
import { stripDrPrefix, capitalizeLanguage } from '@/lib/utils'
import { Search } from 'lucide-react'
import VerifiedBadge from '@/components/ui/VerifiedBadge'

interface Doctor {
  id: string
  specialty: string
  years_experience: number
  is_online: boolean
  bio: string
  languages: string[] | null
  availability: Record<string, unknown> | null
  status: string
  user: { full_name: string; profile_photo_url: string | null } | null
}

export default function BrowseDoctorsPage() {
  const searchParams = useSearchParams()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  // Called on mount, then once more when the realtime channel below reaches
  // SUBSCRIBED — reconciles any toggle that fired during the join-latency
  // window (before SUBSCRIBED), which would otherwise be lost forever. Rows
  // are passed through `reconcile` so this fetch can't revert a live update
  // that already applied while it was in flight.
  function loadDoctors() {
    supabase
      .from('doctor_profiles')
      .select('id, specialty, years_experience, is_online, bio, languages, availability, status, user:users(full_name, profile_photo_url)')
      .eq('status', 'approved')
      .then(({ data }) => {
        setDoctors(((data ?? []) as unknown as Doctor[]).map(reconcile))
        setLoading(false)
      })
  }

  useEffect(() => {
    loadDoctors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime: doctor online/offline status + availability → list re-sorts
  // live (useMemo below depends on `doctors`), no refresh needed
  const { reconcile } = useDoctorOnlineStatus((doctorId, fields) => {
    setDoctors(prev => prev.map(d => d.id === doctorId
      ? { ...d, is_online: fields.is_online, languages: fields.languages ?? d.languages, availability: fields.availability ?? d.availability }
      : d))
  }, () => { loadDoctors() })

  const filtered = useMemo(() => {
    const list = doctors.filter(d =>
      (d.user?.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      d.specialty.toLowerCase().includes(search.toLowerCase())
    )

    // Online doctors always first
    list.sort((a, b) => (b.is_online !== a.is_online ? (b.is_online ? 1 : -1) : 0))

    return list
  }, [doctors, search])

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Find a Doctor</h1>
        <p className="text-ink-black/50 text-sm mt-1">Browse {doctors.length} verified specialists</p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search doctors, specialties…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
        />
      </div>

      {/* Sort indicator */}
      <p className="text-xs text-ink-black/40 mb-4 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-success inline-block" /> Online doctors shown first
      </p>

      {/* Doctor cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-52 shimmer-bg rounded-3xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <Search size={40} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black">No doctors found</p>
          <p className="text-ink-black/50 text-sm mt-1">Try different filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(d => (
            <div key={d.id} className="card card-hover p-5 flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                  {d.user?.profile_photo_url ? (
                    <img src={d.user.profile_photo_url} alt={d.user.full_name ?? ''} className="w-14 h-14 rounded-2xl object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg">
                      {stripDrPrefix(d.user?.full_name ?? '?').charAt(0)}
                    </div>
                  )}
                  {d.is_online && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-success border-2 border-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-base text-ink-black flex items-center gap-1.5">
                    <span className="truncate">Dr. {stripDrPrefix(d.user?.full_name ?? '')}</span>
                    {d.status === 'approved' && <VerifiedBadge size={15} />}
                  </p>
                  <p className="text-ink-black/50 text-xs">{d.specialty} · {d.years_experience}yr exp</p>
                  <div className="flex items-center gap-2 mt-1">
                    {d.is_online ? (
                      <span className="flex items-center gap-1 text-success text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" /> Online
                      </span>
                    ) : (
                      <span className="text-ink-black/30 text-[10px]">Offline</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bio */}
              {d.bio && (
                <p className="text-ink-black/60 text-xs leading-relaxed line-clamp-2">{d.bio}</p>
              )}

              {/* Languages */}
              {d.languages && d.languages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {d.languages.map(lang => (
                    <span key={lang} className="bg-teal-50 text-teal-green text-[10px] font-semibold font-montserrat px-2.5 py-1 rounded-full border border-teal-green/20">
                      {capitalizeLanguage(lang)}
                    </span>
                  ))}
                </div>
              )}

              {/* CTA */}
              <a href={`/patient/doctors/${d.id}`} className="btn-primary w-full h-10 text-sm rounded-xl text-center flex items-center justify-center">
                View &amp; Book →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
