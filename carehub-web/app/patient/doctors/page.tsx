'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Doctor {
  id: string
  specialty: string
  years_experience: number
  chat_price: number
  phone_price: number
  video_price: number
  rating_average: number
  total_consultations: number
  is_online: boolean
  bio: string
  user: { full_name: string; profile_photo_url: string | null } | null
}

const SPECIALTIES = ['All', 'General Practice', 'Cardiology', 'Pediatrics', 'Dermatology', 'Neurology', 'Orthopedics', 'Psychiatry', 'Gynecology']
const CONSULT_TYPES = [
  { key: 'chat', label: '💬 Chat', priceKey: 'chat_price' as const },
  { key: 'phone', label: '📞 Phone', priceKey: 'phone_price' as const },
  { key: 'video', label: '🎥 Video', priceKey: 'video_price' as const },
]

export default function BrowseDoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [specialty, setSpecialty] = useState('All')
  const [onlineOnly, setOnlineOnly] = useState(false)

  useEffect(() => {
    async function load() {
      let q = supabase
        .from('doctor_profiles')
        .select('id, specialty, years_experience, chat_price, phone_price, video_price, rating_average, total_consultations, is_online, bio, user:users(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .order('rating_average', { ascending: false })

      if (onlineOnly) q = q.eq('is_online', true)
      if (specialty !== 'All') q = q.eq('specialty', specialty)

      const { data } = await q
      setDoctors((data ?? []) as unknown as Doctor[])
      setLoading(false)
    }
    load()
  }, [specialty, onlineOnly])

  const filtered = doctors.filter(d =>
    (d.user?.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    d.specialty.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Find a Doctor</h1>
        <p className="text-ink-black/50 text-sm mt-1">Browse {doctors.length} verified specialists</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search doctors, specialties…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
          />
          <label className="flex items-center gap-2.5 cursor-pointer bg-white border border-steel-grey rounded-2xl px-4 h-11 select-none">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={e => setOnlineOnly(e.target.checked)}
              className="accent-teal-green w-4 h-4"
            />
            <span className="font-montserrat text-sm text-ink-black">Online only</span>
          </label>
        </div>

        {/* Specialty pills */}
        <div className="flex gap-2 flex-wrap">
          {SPECIALTIES.map(sp => (
            <button
              key={sp}
              onClick={() => setSpecialty(sp)}
              className={`h-9 px-4 rounded-full text-xs font-semibold transition-colors ${
                specialty === sp
                  ? 'bg-gradient-interactive text-white shadow-blue'
                  : 'bg-white border border-steel-grey text-ink-black/60 hover:border-int-blue'
              }`}
            >
              {sp}
            </button>
          ))}
        </div>
      </div>

      {/* Doctor cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-52 shimmer-bg rounded-3xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-4xl mb-3">🔍</p>
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
                  <div className="w-14 h-14 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg">
                    {d.user?.full_name?.charAt(0) ?? '?'}
                  </div>
                  {d.is_online && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-success border-2 border-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-base text-ink-black">Dr. {d.user?.full_name}</p>
                  <p className="text-ink-black/50 text-xs">{d.specialty} · {d.years_experience}yr exp</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-500 text-xs font-bold">★ {d.rating_average?.toFixed(1) ?? 'New'}</span>
                    <span className="text-ink-black/30 text-xs">·</span>
                    <span className="text-ink-black/50 text-xs">{d.total_consultations} consultations</span>
                  </div>
                </div>
              </div>

              {/* Bio */}
              {d.bio && (
                <p className="text-ink-black/60 text-xs leading-relaxed line-clamp-2">{d.bio}</p>
              )}

              {/* Prices */}
              <div className="flex gap-2">
                {CONSULT_TYPES.map(ct => (
                  <div key={ct.key} className="flex-1 bg-cloud-grey rounded-xl p-2 text-center">
                    <p className="text-[10px] text-ink-black/50">{ct.label}</p>
                    <p className="font-bold text-xs text-ink-black">{d[ct.priceKey] ? `ETB ${d[ct.priceKey]}` : 'Free'}</p>
                  </div>
                ))}
              </div>

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
