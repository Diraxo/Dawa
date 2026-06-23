'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'

interface DoctorProfile {
  id: string
  specialty: string
  years_experience: number
  hospital_name: string
  bio: string
  chat_price: number
  phone_price: number
  video_price: number
  rating_average: number
  total_consultations: number
  is_online: boolean
  user: { full_name: string; email: string; profile_photo_url: string | null } | null
}

interface Review {
  id: string
  rating: number
  comment: string
  created_at: string
  patient: { full_name: string } | null
}

const CONSULT_TYPES = [
  { key: 'chat', icon: '💬', label: 'Chat Consultation', desc: 'Text messaging, images, voice notes', priceKey: 'chat_price' as const },
  { key: 'phone', icon: '📞', label: 'Phone Call', desc: 'Audio-only consultation', priceKey: 'phone_price' as const },
  { key: 'video', icon: '🎥', label: 'Video Call', desc: 'Face-to-face video consultation', priceKey: 'video_price' as const },
]

export default function DoctorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [doctor, setDoctor] = useState<DoctorProfile | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [imageFullscreen, setImageFullscreen] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: doc }, { data: revs }] = await Promise.all([
        supabase
          .from('doctor_profiles')
          .select('id, specialty, years_experience, hospital_name, bio, chat_price, phone_price, video_price, rating_average, total_consultations, is_online, user:users(full_name, email, profile_photo_url)')
          .eq('id', id)
          .eq('status', 'approved')
          .single(),
        supabase
          .from('reviews')
          .select('id, rating, comment, created_at, patient:users!patient_id(full_name)')
          .eq('doctor_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      setDoctor(doc as unknown as DoctorProfile)
      setReviews((revs ?? []) as unknown as Review[])
      setLoading(false)
    }
    load()
  }, [id])

  function handleBook() {
    if (!selectedType) return
    router.push(`/patient/booking/${id}?type=${selectedType}`)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading doctor profile…</div>
      </div>
    )
  }

  if (!doctor) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-4xl">🔍</p>
        <p className="font-montserrat font-bold text-xl text-ink-black">Doctor not found</p>
        <Link href="/patient/doctors" className="btn-primary h-10 px-6 text-sm rounded-xl">
          Back to Doctors
        </Link>
      </div>
    )
  }

  const starsDisplay = (n: number) =>
    Array.from({ length: 5 }).map((_, i) => (
      <span key={i} className={i < Math.round(n) ? 'text-yellow-400' : 'text-steel-grey'}>★</span>
    ))

  return (
    <div className="p-8 max-w-6xl">
      {/* Fullscreen image overlay */}
      {imageFullscreen && doctor.user?.profile_photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setImageFullscreen(false)}
        >
          <button
            onClick={() => setImageFullscreen(false)}
            className="absolute top-6 right-6 w-11 h-11 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/25 transition-colors text-2xl font-bold"
            aria-label="Close"
          >
            ✕
          </button>
          <img
            src={doctor.user.profile_photo_url}
            alt={doctor.user.full_name ?? ''}
            className="max-w-full max-h-[85vh] object-contain rounded-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Back */}
      <Link href="/patient/doctors" className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors">
        ← Back to Doctors
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Left column — identity */}
        <div className="lg:col-span-1">
          <div className="card p-6 flex flex-col items-center text-center gap-4">
            <div className="relative">
              {doctor.user?.profile_photo_url ? (
                <button
                  onClick={() => setImageFullscreen(true)}
                  className="focus:outline-none"
                  title="View full image"
                >
                  <img
                    src={doctor.user.profile_photo_url}
                    alt={doctor.user.full_name ?? ''}
                    className="w-24 h-24 rounded-3xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  />
                </button>
              ) : (
                <div className="w-24 h-24 rounded-3xl bg-gradient-hero flex items-center justify-center text-white font-black text-3xl">
                  {stripDrPrefix(doctor.user?.full_name ?? '?').charAt(0)}
                </div>
              )}
              {doctor.is_online && (
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-success border-2 border-white" />
              )}
            </div>

            <div>
              <h1 className="font-montserrat font-black text-xl text-ink-black">Dr. {stripDrPrefix(doctor.user?.full_name ?? '')}</h1>
              <p className="text-int-blue font-semibold text-sm mt-0.5">{doctor.specialty}</p>
              <p className="text-ink-black/50 text-xs mt-1">{doctor.hospital_name}</p>
            </div>

            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${doctor.is_online ? 'bg-success/10 text-success' : 'bg-steel-grey/50 text-ink-black/40'}`}>
              <div className={`w-2 h-2 rounded-full ${doctor.is_online ? 'bg-success' : 'bg-steel-grey'}`} />
              {doctor.is_online ? 'Available Now' : 'Offline'}
            </div>

            <div className="w-full border-t border-steel-grey pt-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-black/50">Experience</span>
                <span className="font-semibold text-ink-black">{doctor.years_experience} years</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-black/50">Consultations</span>
                <span className="font-semibold text-ink-black">{doctor.total_consultations}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-ink-black/50">Rating</span>
                <span className="font-bold text-ink-black">
                  {doctor.rating_average ? `★ ${doctor.rating_average.toFixed(1)}` : 'No reviews'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — booking */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Bio */}
          {doctor.bio && (
            <div className="card p-5">
              <h2 className="font-montserrat font-bold text-base text-ink-black mb-2">About</h2>
              <p className="text-ink-black/60 text-sm leading-relaxed">{doctor.bio}</p>
            </div>
          )}

          {/* Consultation type selection */}
          <div className="card p-5">
            <h2 className="font-montserrat font-bold text-base text-ink-black mb-3">Choose Consultation Type</h2>
            <div className="flex flex-col gap-3">
              {CONSULT_TYPES.map(ct => (
                <button
                  key={ct.key}
                  onClick={() => setSelectedType(ct.key)}
                  className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                    selectedType === ct.key
                      ? 'border-int-blue bg-int-blue/5'
                      : 'border-steel-grey hover:border-int-blue/40'
                  }`}
                >
                  <span className="text-2xl">{ct.icon}</span>
                  <div className="flex-1">
                    <p className="font-montserrat font-bold text-sm text-ink-black">{ct.label}</p>
                    <p className="text-ink-black/50 text-xs">{ct.desc}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-sm text-ink-black">
                      {doctor[ct.priceKey] ? `ETB ${doctor[ct.priceKey]}` : 'Free'}
                    </p>
                    <p className="text-ink-black/40 text-xs">per session</p>
                  </div>
                  {selectedType === ct.key && (
                    <div className="w-5 h-5 rounded-full bg-int-blue flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={handleBook}
              disabled={!selectedType || !doctor.is_online}
              className="btn-primary w-full mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {!doctor.is_online ? 'Doctor is Offline' : !selectedType ? 'Select a Consultation Type' : 'Book Consultation →'}
            </button>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div className="card p-6">
        <div className="flex items-center gap-4 mb-5">
          <div>
            <h2 className="font-montserrat font-bold text-lg text-ink-black">Patient Reviews</h2>
            <p className="text-ink-black/50 text-sm">{reviews.length} reviews</p>
          </div>
          {doctor.rating_average > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="font-black text-3xl text-ink-black">{doctor.rating_average.toFixed(1)}</span>
              <div className="flex flex-col">
                <div className="flex text-lg">{starsDisplay(doctor.rating_average)}</div>
                <p className="text-xs text-ink-black/40">out of 5</p>
              </div>
            </div>
          )}
        </div>

        {reviews.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-2">💬</p>
            <p className="text-ink-black/50 text-sm">No reviews yet. Be the first!</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-steel-grey">
            {reviews.map(r => (
              <div key={r.id} className="py-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-interactive flex items-center justify-center text-white text-xs font-bold">
                      {r.patient?.full_name?.charAt(0) ?? 'P'}
                    </div>
                    <span className="font-montserrat font-semibold text-sm text-ink-black">
                      {r.patient?.full_name ?? 'Patient'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex text-sm">{starsDisplay(r.rating)}</div>
                    <span className="text-ink-black/40 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {r.comment && (
                  <p className="text-ink-black/60 text-sm leading-relaxed ml-10">{r.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
