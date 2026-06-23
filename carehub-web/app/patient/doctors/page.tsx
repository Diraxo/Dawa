'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { stripDrPrefix } from '@/lib/utils'

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

const CONSULT_TYPES = [
  { key: 'chat', label: '💬 Chat', priceKey: 'chat_price' as const },
  { key: 'phone', label: '📞 Phone', priceKey: 'phone_price' as const },
  { key: 'video', label: '🎥 Video', priceKey: 'video_price' as const },
]

const PRICE_FILTERS = [
  { label: 'Any Price', max: Infinity },
  { label: '< ETB 200', max: 200 },
  { label: '< ETB 400', max: 400 },
]

const RATING_FILTERS = [
  { label: 'Any Rating', min: 0 },
  { label: '4.0+', min: 4.0 },
  { label: '4.5+', min: 4.5 },
  { label: '4.8+', min: 4.8 },
]

export default function BrowseDoctorsPage() {
  const searchParams = useSearchParams()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') ?? 'All')
  const [specialtiesList, setSpecialtiesList] = useState<string[]>(['All'])
  const [priceIdx, setPriceIdx] = useState(0)
  const [ratingIdx, setRatingIdx] = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('specialties').select('name').order('name'),
      supabase.from('doctor_profiles').select('specialty').eq('status', 'approved').not('specialty', 'is', null),
    ]).then(([adminRes, usedRes]) => {
      const adminSet = new Set((adminRes.data ?? []).map((s: any) => s.name as string))
      const withDoctors = [...new Set(
        (usedRes.data ?? []).map((d: any) => d.specialty as string).filter(Boolean)
      )].filter(s => adminSet.has(s)).sort()
      if (withDoctors.length) setSpecialtiesList(['All', ...withDoctors])
    })
  }, [])

  useEffect(() => {
    async function load() {
      let q = supabase
        .from('doctor_profiles')
        .select('id, specialty, years_experience, chat_price, phone_price, video_price, rating_average, total_consultations, is_online, bio, user:users(full_name, profile_photo_url)')
        .eq('status', 'approved')

      if (specialty !== 'All') q = q.eq('specialty', specialty)

      const { data } = await q
      setDoctors((data ?? []) as unknown as Doctor[])
      setLoading(false)
    }
    load()
  }, [specialty])

  const filtered = useMemo(() => {
    let list = doctors.filter(d =>
      (d.user?.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      d.specialty.toLowerCase().includes(search.toLowerCase())
    )

    const minRating = RATING_FILTERS[ratingIdx].min
    if (minRating > 0) list = list.filter(d => d.rating_average >= minRating)

    const maxPrice = PRICE_FILTERS[priceIdx].max
    if (maxPrice < Infinity) {
      list = list.filter(d =>
        d.chat_price <= maxPrice ||
        d.phone_price <= maxPrice ||
        d.video_price <= maxPrice
      )
    }

    // Online doctors always first, then by rating
    list.sort((a, b) => {
      if (b.is_online !== a.is_online) return b.is_online ? 1 : -1
      return b.rating_average - a.rating_average
    })

    return list
  }, [doctors, search, priceIdx, ratingIdx])

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

      {/* Specialty pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        {specialtiesList.map(sp => (
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

      {/* Rating + Price chips */}
      <div className="flex gap-2 flex-wrap mb-6">
        {RATING_FILTERS.map((r, idx) => (
          <button
            key={r.label}
            onClick={() => setRatingIdx(idx)}
            className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors border ${
              ratingIdx === idx
                ? 'bg-teal-green text-white border-teal-green'
                : 'bg-white border-steel-grey text-ink-black/60 hover:border-teal-green'
            }`}
          >
            {idx > 0 && '★ '}{r.label}
          </button>
        ))}
        <div className="w-px h-8 bg-steel-grey self-center" />
        {PRICE_FILTERS.map((p, idx) => (
          <button
            key={p.label}
            onClick={() => setPriceIdx(idx)}
            className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors border ${
              priceIdx === idx
                ? 'bg-care-blue text-white border-care-blue'
                : 'bg-white border-steel-grey text-ink-black/60 hover:border-care-blue'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Sort indicator */}
      <p className="text-xs text-ink-black/40 mb-4 flex items-center gap-1">
        <span>🏆</span> Online doctors shown first, then sorted by rating
      </p>

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
                  <p className="font-montserrat font-bold text-base text-ink-black">Dr. {stripDrPrefix(d.user?.full_name ?? '')}</p>
                  <p className="text-ink-black/50 text-xs">{d.specialty} · {d.years_experience}yr exp</p>
                  <div className="flex items-center gap-2 mt-1">
                    {d.is_online ? (
                      <span className="flex items-center gap-1 text-success text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" /> Online
                      </span>
                    ) : (
                      <span className="text-ink-black/30 text-[10px]">Offline</span>
                    )}
                    <span className="text-ink-black/30 text-[10px]">·</span>
                    <span className="text-yellow-500 text-[10px]">★ {d.rating_average?.toFixed(1) ?? 'New'}</span>
                    <span className="text-ink-black/30 text-[10px]">·</span>
                    <span className="text-ink-black/50 text-[10px]">{d.total_consultations} consults</span>
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
