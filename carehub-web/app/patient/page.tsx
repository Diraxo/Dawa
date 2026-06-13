'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'
import { getGreeting } from '@/lib/utils'
import Link from 'next/link'
import { MessageCircle, Phone, Video } from 'lucide-react'

interface Doctor {
  id: string
  specialty: string
  chat_price: number
  phone_price: number
  video_price: number
  rating_average: number
  is_online: boolean
  user: { full_name: string; profile_photo_url: string | null } | null
}

const CONSULT_TYPES = [
  { icon: MessageCircle, label: 'Chat', desc: 'Text messaging', color: 'from-int-blue to-care-blue' },
  { icon: Phone, label: 'Phone', desc: 'Audio call', color: 'from-care-blue to-teal-green' },
  { icon: Video, label: 'Video', desc: 'Video call', color: 'from-teal-green to-emerald-400' },
]

export default function PatientHomePage() {
  const { user } = useUser()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('doctor_profiles')
        .select('id, specialty, chat_price, phone_price, video_price, rating_average, is_online, user:users(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .eq('is_online', true)
        .limit(4)
      setDoctors((data ?? []) as unknown as Doctor[])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-8 max-w-5xl">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">
          {getGreeting()}, {user?.firstName ?? 'there'} 👋
        </h1>
        <p className="text-ink-black/50 text-sm mt-1">How are you feeling today?</p>
      </div>

      {/* Hero card */}
      <div className="rounded-3xl p-7 mb-8 text-white"
        style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}>
        <p className="font-montserrat font-bold text-2xl mb-2">Talk to a Doctor Now</p>
        <p className="text-white/70 text-sm mb-5">Connect with a specialist in under 2 minutes, 24/7.</p>
        <Link href="/patient/doctors" className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 transition-colors px-5 py-2.5 rounded-2xl font-semibold text-sm">
          Browse Doctors →
        </Link>
      </div>

      {/* Consultation types */}
      <div className="mb-8">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Consultation Types</h2>
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

      {/* Available doctors */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-montserrat font-bold text-lg text-ink-black">Available Now</h2>
          <Link href="/patient/doctors" className="text-teal-green text-sm font-semibold hover:underline">
            See all →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="card p-4 h-24 shimmer-bg rounded-3xl" />
            ))}
          </div>
        ) : doctors.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-4xl mb-2">😔</p>
            <p className="text-ink-black/50 text-sm">No doctors are online right now. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {doctors.map(d => (
              <div key={d.id} className="card card-hover p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-bold flex-shrink-0">
                  {d.user?.full_name?.charAt(0) ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {d.user?.full_name}</p>
                  <p className="text-ink-black/50 text-xs">{d.specialty}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-success text-[10px] font-semibold">Online</span>
                    <span className="text-ink-black/30 text-[10px]">·</span>
                    <span className="text-yellow-500 text-[10px]">★ {d.rating_average?.toFixed(1) ?? 'New'}</span>
                  </div>
                </div>
                <Link href={`/patient/doctors/${d.id}`}
                  className="btn-primary h-9 px-3 text-xs rounded-xl flex-shrink-0">
                  Book
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
