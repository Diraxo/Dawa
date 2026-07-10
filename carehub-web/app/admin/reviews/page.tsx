'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { MessageCircle, Phone, Video, Inbox, Star } from 'lucide-react'

interface Review {
  id: string
  rating: number
  comment: string | null
  created_at: string
  hidden: boolean
  hidden_reason: string | null
  patient: { full_name: string } | null
  doctor: { user: { full_name: string } | null } | null
  consultation: { type: string } | null
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-sm">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < rating ? 'text-yellow-400' : 'text-steel-grey'}>★</span>
      ))}
    </span>
  )
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden'>('all')
  const [actionId, setActionId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonModal, setReasonModal] = useState<{ id: string; hide: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadReviews() {
    setLoading(true)
    const { data } = await supabase
      .from('reviews')
      .select(`
        id, rating, comment, created_at, hidden, hidden_reason,
        patient:users!patient_id(full_name),
        doctor:doctor_profiles!doctor_id(user:users(full_name)),
        consultation:consultations!consultation_id(type)
      `)
      .order('created_at', { ascending: false })
    setReviews((data ?? []) as unknown as Review[])
    setLoading(false)
  }

  useEffect(() => { loadReviews() }, [])

  async function toggleHide(id: string, hide: boolean, hiddenReason?: string) {
    setSaving(true)
    await supabase
      .from('reviews')
      .update({ hidden: hide, hidden_reason: hide ? (hiddenReason ?? null) : null })
      .eq('id', id)
    await loadReviews()
    setSaving(false)
    setReasonModal(null)
    setReason('')
    setActionId(null)
  }

  const filtered = reviews.filter(r => {
    if (filter === 'visible') return !r.hidden
    if (filter === 'hidden') return r.hidden
    return true
  })

  const visibleCount = reviews.filter(r => !r.hidden).length
  const hiddenCount = reviews.filter(r => r.hidden).length
  const avgRating = visibleCount > 0
    ? (reviews.filter(r => !r.hidden).reduce((s, r) => s + r.rating, 0) / visibleCount).toFixed(2)
    : '—'

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Review Moderation</h1>
        <p className="text-ink-black/50 text-sm mt-1">Moderate patient reviews. Hidden reviews are excluded from doctor ratings.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Reviews', value: reviews.length, color: 'text-care-blue' },
          { label: 'Visible', value: visibleCount, color: 'text-teal-green' },
          { label: 'Hidden', value: hiddenCount, color: 'text-warning' },
        ].map(s => (
          <div key={s.label} className="card p-5 text-center">
            <p className={`font-montserrat font-black text-3xl ${s.color}`}>{s.value}</p>
            <p className="text-ink-black/50 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Platform avg */}
      <div className="card p-5 mb-6 flex items-center gap-4">
        <Star size={30} className="text-yellow-400 fill-yellow-400" />
        <div>
          <p className="font-montserrat font-bold text-xl text-ink-black">{avgRating} / 5.00</p>
          <p className="text-ink-black/40 text-xs">Platform-wide average (visible reviews only)</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'visible', 'hidden'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-montserrat font-semibold transition-all capitalize ${
              filter === f
                ? 'bg-gradient-interactive text-white shadow-blue'
                : 'bg-cloud-grey text-ink-black/60 hover:text-ink-black'
            }`}
          >
            {f} {f === 'all' ? `(${reviews.length})` : f === 'visible' ? `(${visibleCount})` : `(${hiddenCount})`}
          </button>
        ))}
      </div>

      {/* Review list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 shimmer-bg rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-ink-black">No reviews in this category</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(review => {
            const patientName = (review.patient as any)?.full_name ?? 'Patient'
            const doctorName = (review.doctor as any)?.user?.full_name ?? 'Doctor'
            const type = (review.consultation as any)?.type ?? 'chat'
            const TypeIcon = TYPE_ICONS[type] ?? MessageCircle
            return (
              <div key={review.id} className={`card p-5 transition-all ${review.hidden ? 'opacity-60 border border-warning/30 bg-warning/5' : ''}`}>
                <div className="flex items-start gap-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
                  >
                    {patientName[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <div>
                        <p className="font-montserrat font-bold text-sm text-ink-black">{patientName}</p>
                        <p className="text-xs text-ink-black/40 flex items-center gap-1">
                          <TypeIcon size={12} /> {type} consultation · Dr. {doctorName} · {formatDate(review.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Stars rating={review.rating} />
                        {review.hidden && (
                          <span className="text-[10px] font-bold text-warning bg-warning/15 px-2 py-0.5 rounded-full">
                            HIDDEN
                          </span>
                        )}
                      </div>
                    </div>
                    {review.comment && (
                      <div className="mt-2 bg-cloud-grey rounded-xl px-3 py-2">
                        <p className="text-sm text-ink-black/70">"{review.comment}"</p>
                      </div>
                    )}
                    {review.hidden && review.hidden_reason && (
                      <p className="text-xs text-warning mt-2">
                        <span className="font-semibold">Hidden reason:</span> {review.hidden_reason}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {review.hidden ? (
                      <button
                        onClick={() => toggleHide(review.id, false)}
                        disabled={saving && actionId === review.id}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold font-montserrat bg-teal-green/10 text-teal-green hover:bg-teal-green/20 transition-colors disabled:opacity-40"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => { setReasonModal({ id: review.id, hide: true }); setReason('') }}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold font-montserrat bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                      >
                        Hide
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Hide reason modal */}
      {reasonModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hide-review-title"
        >
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 id="hide-review-title" className="font-montserrat font-bold text-xl text-ink-black mb-2">Hide Review</h2>
            <p className="text-ink-black/50 text-sm mb-5">Optionally provide a reason for hiding this review. The review will be excluded from the doctor&apos;s rating.</p>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (optional, e.g. Inappropriate content)"
              rows={3}
              autoFocus
              aria-label="Reason for hiding this review"
              className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm font-montserrat text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue mb-5 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setReasonModal(null)}
                className="flex-1 btn-outline rounded-xl h-11 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setActionId(reasonModal.id)
                  toggleHide(reasonModal.id, true, reason.trim() || undefined)
                }}
                disabled={saving}
                className="flex-1 rounded-xl h-11 text-sm font-montserrat font-semibold bg-warning text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {saving ? 'Hiding…' : 'Hide Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
