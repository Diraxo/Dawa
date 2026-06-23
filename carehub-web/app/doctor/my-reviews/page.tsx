'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

interface Review {
  id: string
  rating: number
  comment: string | null
  created_at: string
  patient: { full_name: string } | null
  consultation: { type: string } | null
}

const TYPE_ICONS: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }

function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={size === 'lg' ? 'text-2xl' : 'text-sm'}>
          {i <= rating ? '⭐' : '☆'}
        </span>
      ))}
    </div>
  )
}

export default function DoctorMyReviewsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [avgRating, setAvgRating] = useState(0)

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
        .select('id, rating_average')
        .eq('user_id', (ud as any).id)
        .single()
      if (!dp) { setLoading(false); return }

      setAvgRating(Number((dp as any).rating_average ?? 0))

      const { data } = await client
        .from('reviews')
        .select(`
          id, rating, comment, created_at,
          patient:users!patient_id(full_name),
          consultation:consultations!consultation_id(type)
        `)
        .eq('doctor_id', (dp as any).id)
        .order('created_at', { ascending: false })

      setReviews((data ?? []) as unknown as Review[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">My Reviews</h1>
        <p className="text-ink-black/50 text-sm mt-1">Patient ratings and feedback</p>
      </div>

      {/* Summary card */}
      <div
        className="rounded-3xl p-8 mb-6 flex items-center gap-8"
        style={{ background: 'linear-gradient(to right, #1A4598, #00BFA5)' }}
      >
        <div className="text-center">
          <p className="font-montserrat font-black text-6xl text-white leading-none">
            {avgRating > 0 ? avgRating.toFixed(1) : '—'}
          </p>
          <div className="flex justify-center mt-2">
            <Stars rating={Math.round(avgRating)} size="lg" />
          </div>
        </div>
        <div>
          <p className="text-white font-montserrat font-bold text-lg">Average Rating</p>
          <p className="text-white/60 text-sm mt-1">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'} total</p>
        </div>
      </div>

      {/* Review list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 shimmer-bg rounded-2xl" />)}
        </div>
      ) : reviews.length === 0 ? (
        <div className="card p-14 text-center">
          <p className="text-4xl mb-4">⭐</p>
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No reviews yet</p>
          <p className="text-ink-black/50 text-sm">Patient reviews will appear here after consultations.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map(review => {
            const patientName = (review.patient as any)?.full_name ?? 'Patient'
            const type = (review.consultation as any)?.type ?? 'chat'
            return (
              <div key={review.id} className="card p-5">
                <div className="flex items-start gap-4">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-lg flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
                  >
                    {patientName[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="font-montserrat font-bold text-sm text-ink-black">{patientName}</p>
                        <p className="text-xs text-ink-black/40">
                          {TYPE_ICONS[type]} {type.charAt(0).toUpperCase() + type.slice(1)} consultation · {formatDate(review.created_at)}
                        </p>
                      </div>
                      <Stars rating={review.rating} />
                    </div>
                    {review.comment && (
                      <div className="mt-3 bg-cloud-grey rounded-xl px-4 py-3">
                        <p className="text-sm text-ink-black/70 leading-relaxed">"{review.comment}"</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
