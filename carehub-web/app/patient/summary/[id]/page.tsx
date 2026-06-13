'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

interface Summary {
  id: string
  chief_complaint: string
  diagnosis: string
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean
  created_at: string
}

interface ConsultationDetail {
  id: string
  type: string
  status: string
  started_at: string | null
  ended_at: string | null
  duration_minutes: number | null
  patient_amount: number
  doctor_id: string
  doctor: {
    specialty: string
    hospital_name: string
    user: { full_name: string } | null
  } | null
  consultation_summaries: Summary[]
}

export default function ConsultationSummaryPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<ConsultationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rated, setRated] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (token && user) {
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (userData) setMyUserId(userData.id)
      }

      const { data } = await supabase
        .from('consultations')
        .select(`
          id, type, status, started_at, ended_at, duration_minutes, patient_amount, doctor_id,
          doctor:doctor_profiles!doctor_id(specialty, hospital_name, user:users(full_name)),
          consultation_summaries(id, chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed, created_at)
        `)
        .eq('id', id)
        .single()

      setConsultation(data as unknown as ConsultationDetail)

      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('consultation_id', id)
        .limit(1)
      if (existingReview && existingReview.length > 0) setRated(true)

      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  async function submitRating() {
    if (!rating || !myUserId || !consultation) return
    setSubmitting(true)
    const token = await getToken()
    if (!token) { setSubmitting(false); return }
    const client = getAuthClient(token)
    await client.from('reviews').insert({
      consultation_id: id,
      patient_id: myUserId,
      doctor_id: consultation.doctor_id,
      rating,
      comment: comment.trim() || null,
    })
    setRated(true)
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading summary…</div>
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="p-8 text-center">
        <p className="font-montserrat font-bold text-ink-black mb-4">Summary not found</p>
        <Link href="/patient/appointments" className="btn-primary h-10 px-6 text-sm rounded-xl inline-flex items-center">
          My Appointments
        </Link>
      </div>
    )
  }

  const typeIcon = consultation.type === 'chat' ? '💬' : consultation.type === 'phone' ? '📞' : '🎥'
  const sum = consultation.consultation_summaries?.[0] ?? null

  const starsDisplay = (n: number) =>
    Array.from({ length: 5 }).map((_, i) => (
      <span key={i} className={i < Math.round(n) ? 'text-yellow-400' : 'text-steel-grey'}>★</span>
    ))

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/patient/appointments" className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors">
        ← My Appointments
      </Link>

      {/* Summary document */}
      <div className="card overflow-hidden mb-6">
        {/* Header */}
        <div className="p-6 border-b border-steel-grey flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="font-montserrat font-bold text-base text-ink-black">CARE<span className="text-teal-green">HUB</span></span>
          </div>
          <button
            onClick={() => window.print()}
            className="btn-outline h-9 px-4 text-xs rounded-xl"
          >
            🖨️ Print / Save PDF
          </button>
        </div>

        {/* Doctor + meta */}
        <div className="p-6 border-b border-steel-grey bg-cloud-grey/50">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-xl">
              {consultation.doctor?.user?.full_name?.charAt(0) ?? '?'}
            </div>
            <div>
              <p className="font-montserrat font-bold text-base text-ink-black">Dr. {consultation.doctor?.user?.full_name}</p>
              <p className="text-ink-black/60 text-sm">{consultation.doctor?.specialty} · {consultation.doctor?.hospital_name}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-ink-black/40 uppercase tracking-wider font-bold mb-0.5">Date</p>
              <p className="font-semibold text-ink-black">{consultation.started_at ? formatDate(consultation.started_at) : '—'}</p>
            </div>
            <div>
              <p className="text-ink-black/40 uppercase tracking-wider font-bold mb-0.5">Type</p>
              <p className="font-semibold text-ink-black">{typeIcon} {consultation.type}</p>
            </div>
            <div>
              <p className="text-ink-black/40 uppercase tracking-wider font-bold mb-0.5">Duration</p>
              <p className="font-semibold text-ink-black">{consultation.duration_minutes ? `${consultation.duration_minutes} min` : '—'}</p>
            </div>
            <div>
              <p className="text-ink-black/40 uppercase tracking-wider font-bold mb-0.5">Fee Paid</p>
              <p className="font-semibold text-ink-black">ETB {consultation.patient_amount}</p>
            </div>
          </div>
        </div>

        {/* Clinical notes */}
        {sum ? (
          <div className="divide-y divide-steel-grey">
            <div className="p-6">
              <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Chief Complaint</p>
              <p className="text-sm text-ink-black leading-relaxed">{sum.chief_complaint}</p>
            </div>
            <div className="p-6">
              <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Diagnosis</p>
              <p className="text-sm text-ink-black leading-relaxed">{sum.diagnosis}</p>
            </div>
            {sum.prescription && (
              <div className="p-6">
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Prescription</p>
                <p className="text-sm text-ink-black leading-relaxed whitespace-pre-line">{sum.prescription}</p>
              </div>
            )}
            {sum.followup_recommendation && (
              <div className="p-6">
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Follow-up Recommendation</p>
                <p className="text-sm text-ink-black leading-relaxed">{sum.followup_recommendation}</p>
              </div>
            )}
            {sum.referral_needed && (
              <div className="p-6">
                <div className="bg-info/10 border border-info/20 rounded-xl px-4 py-3 text-info text-sm font-semibold">
                  📋 Doctor recommends a specialist referral
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-3xl mb-2">⏳</p>
            <p className="text-ink-black/50 text-sm">The doctor hasn&apos;t submitted consultation notes yet.</p>
          </div>
        )}
      </div>

      {/* Rating */}
      {!rated ? (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Rate Your Doctor</h2>
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(n)}
                className="text-3xl transition-transform hover:scale-110"
              >
                <span className={(hoverRating || rating) >= n ? 'text-yellow-400' : 'text-steel-grey'}>★</span>
              </button>
            ))}
            {rating > 0 && <span className="text-ink-black/50 text-sm ml-2">{rating} / 5</span>}
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Leave a comment (optional)…"
            rows={3}
            className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue mb-4 resize-none"
          />
          <button
            onClick={submitRating}
            disabled={!rating || submitting}
            className="btn-primary w-full disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Submit Rating →'}
          </button>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <p className="text-3xl mb-2">🙏</p>
          <p className="font-montserrat font-bold text-ink-black">Thank you for your feedback!</p>
          <p className="text-ink-black/50 text-sm mt-1">Your review helps other patients find great doctors.</p>
          <div className="flex justify-center gap-1 mt-3 text-xl">
            {starsDisplay(rating || 5)}
          </div>
          <Link href="/patient/appointments" className="btn-primary inline-flex mt-4 h-10 px-6 text-sm rounded-xl items-center">
            Back to Appointments
          </Link>
        </div>
      )}
    </div>
  )
}
