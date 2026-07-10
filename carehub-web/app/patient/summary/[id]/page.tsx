'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDate, stripDrPrefix, parsePrescription } from '@/lib/utils'
import { getReportSignedUrl } from '@/lib/consultationReport'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'
import { MessageCircle, Phone, Video } from 'lucide-react'

interface Summary {
  id: string
  chief_complaint: string
  diagnosis: string
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean
  referral_specialty: string | null
  report_pdf_path: string | null
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
}

export default function ConsultationSummaryPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<ConsultationDetail | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rated, setRated] = useState(false)
  const [existingReviewId, setExistingReviewId] = useState<string | null>(null)
  const [editingRating, setEditingRating] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    let tokenAttempts = 0
    let consultAttempts = 0
    let summaryAttempts = 0

    // The summary is fetched independently from the consultation's metadata
    // (doctor/type/date). Previously both lived in one nested `.single()`
    // query, so a transient hiccup anywhere in that join (e.g. the nested
    // doctor lookup) blanked the whole page with "Summary not found" even
    // when the summary itself existed and was fetchable. Splitting them
    // means a summary that loads successfully is never hidden by an
    // unrelated metadata hiccup, and only the summary query's own outcome
    // decides the "hasn't submitted yet" vs. real-content state.
    async function loadSummary(client: ReturnType<typeof getAuthClient>) {
      const { data, error } = await client
        .from('consultation_summaries')
        .select('id, chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed, referral_specialty, report_pdf_path, created_at')
        .eq('consultation_id', id)
        .maybeSingle()

      if (cancelled) return
      if (error && summaryAttempts < 3) { summaryAttempts += 1; setTimeout(() => loadSummary(client), 600); return }
      setSummary((data as Summary) ?? null)
    }

    async function loadConsultation(client: ReturnType<typeof getAuthClient>): Promise<void> {
      const { data, error } = await client
        .from('consultations')
        .select(`
          id, type, status, started_at, ended_at, duration_minutes, patient_amount, doctor_id,
          doctor:doctor_profiles!doctor_id(specialty, hospital_name, user:users(full_name))
        `)
        .eq('id', id)
        .maybeSingle()

      if (cancelled) return
      if (error && consultAttempts < 3) { consultAttempts += 1; setTimeout(() => loadConsultation(client), 600); return }
      setConsultation((data as unknown as ConsultationDetail) ?? null)
    }

    async function load() {
      const token = await getToken()
      if (cancelled) return
      if (!token || !user) {
        if (tokenAttempts < 5) { tokenAttempts += 1; setTimeout(load, 400); return }
        setLoading(false)
        return
      }
      const client = getAuthClient(token)
      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!cancelled && userData) setMyUserId(userData.id)

      await Promise.all([loadConsultation(client), loadSummary(client)])
      if (cancelled) return

      const { data: existingReview } = await client
        .from('reviews')
        .select('id, rating, comment')
        .eq('consultation_id', id)
        .limit(1)
      if (!cancelled && existingReview && existingReview.length > 0) {
        setRated(true)
        setExistingReviewId(existingReview[0].id)
        setRating(existingReview[0].rating)
        setComment(existingReview[0].comment ?? '')
      }

      setLoading(false)
    }
    load()

    // Live-refresh if the doctor edits the summary while this page is open —
    // always show the latest version, never a stale cached copy.
    const channel = supabase
      .channel(`patient-summary-page-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_summaries', filter: `consultation_id=eq.${id}` }, () => {
        summaryAttempts = 0
        getToken().then(token => { if (token && !cancelled) loadSummary(getAuthClient(token)) })
      })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  async function getReportBlob(): Promise<Blob | null> {
    if (!summary?.report_pdf_path) return null
    const token = await getToken()
    if (!token) return null
    const url = await getReportSignedUrl(getAuthClient(token), summary.report_pdf_path)
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    return res.blob()
  }

  async function handleDownloadReport() {
    const blob = await getReportBlob()
    if (!blob) { window.print(); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dawa-consultation-report-${id}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleShare() {
    const doctorName = consultation?.doctor?.user?.full_name ?? 'my doctor'
    const shareText = `Consultation summary with Dr. ${stripDrPrefix(doctorName)} — ${consultation?.type} consultation on ${consultation?.started_at ? formatDate(consultation.started_at) : 'recent date'}.`

    const blob = await getReportBlob()
    if (blob && typeof navigator !== 'undefined' && navigator.canShare) {
      const file = new File([blob], `dawa-consultation-report-${id}.pdf`, { type: 'application/pdf' })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: 'Dawa Consultation Report', text: shareText, files: [file] })
          return
        } catch {
          // user dismissed — fall through to link sharing
        }
      }
    }

    const shareData = { title: 'Dawa Consultation Summary', text: shareText, url: window.location.href }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // user dismissed
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href)
        setShareMsg('Link copied!')
        setTimeout(() => setShareMsg(''), 2500)
      } catch {
        setShareMsg('Copy failed')
        setTimeout(() => setShareMsg(''), 2500)
      }
    }
  }

  async function submitRating() {
    if (!rating || !myUserId || !consultation) return
    setSubmitting(true)
    const token = await getToken()
    if (!token) { setSubmitting(false); return }
    const client = getAuthClient(token)
    if (existingReviewId) {
      await client.from('reviews').update({
        rating,
        comment: comment.trim() || null,
      }).eq('id', existingReviewId)
    } else {
      const { data } = await client.from('reviews').insert({
        consultation_id: id,
        patient_id: myUserId,
        doctor_id: consultation.doctor_id,
        rating,
        comment: comment.trim() || null,
      }).select('id').single()
      if (data) setExistingReviewId(data.id)
    }
    setRated(true)
    setEditingRating(false)
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

  const TypeIcon = consultation.type === 'chat' ? MessageCircle : consultation.type === 'phone' ? Phone : Video
  const sum = summary

  const starsDisplay = (n: number) =>
    Array.from({ length: 5 }).map((_, i) => (
      <span key={i} className={i < Math.round(n) ? 'text-yellow-400' : 'text-steel-grey'}>★</span>
    ))

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/patient/appointments" className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors print-hide">
        ← My Appointments
      </Link>

      {/* Summary document */}
      <div className="card print-card overflow-hidden mb-6">
        {/* Header */}
        <div className="p-6 border-b border-steel-grey flex items-center justify-between print-section">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} variant="dark" />
            <span className="font-montserrat font-bold text-base text-ink-black">DA<span className="text-teal-green">WA</span></span>
          </div>
          <div className="hidden print-only">
            <p className="text-xs text-ink-black/50">Official Medical Consultation Record</p>
          </div>
          <div className="flex items-center gap-2 print-hide">
            <button
              onClick={handleShare}
              className="btn-outline h-9 px-4 text-xs rounded-xl"
              aria-label="Share consultation summary"
            >
              {shareMsg || '🔗 Share'}
            </button>
            <button
              onClick={handleDownloadReport}
              disabled={!summary?.report_pdf_path}
              className="btn-outline h-9 px-4 text-xs rounded-xl disabled:opacity-40"
              aria-label="Download consultation report as PDF"
              title={summary?.report_pdf_path ? undefined : 'Report not ready yet'}
            >
              ⬇️ Download Report
            </button>
            <button
              onClick={() => window.print()}
              className="btn-outline h-9 px-4 text-xs rounded-xl"
              aria-label="Print consultation summary"
            >
              🖨️ Print
            </button>
          </div>
        </div>

        {/* Doctor + meta */}
        <div className="p-6 border-b border-steel-grey bg-cloud-grey/50">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-xl">
              {stripDrPrefix(consultation.doctor?.user?.full_name ?? '?').charAt(0)}
            </div>
            <div>
              <p className="font-montserrat font-bold text-base text-ink-black">Dr. {stripDrPrefix(consultation.doctor?.user?.full_name ?? '')}</p>
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
              <p className="font-semibold text-ink-black inline-flex items-center gap-1.5"><TypeIcon size={14} /> {consultation.type}</p>
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
            <div className="p-6 print-section">
              <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Chief Complaint</p>
              <p className="text-sm text-ink-black leading-relaxed">{sum.chief_complaint}</p>
            </div>
            <div className="p-6 print-section">
              <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Diagnosis</p>
              <p className="text-sm text-ink-black leading-relaxed">{sum.diagnosis}</p>
            </div>
            {sum.prescription && (
              <div className="p-6 print-section">
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Prescription</p>
                {(() => {
                  const rxList = parsePrescription(sum.prescription)
                  if (!rxList) {
                    return <p className="text-sm text-ink-black leading-relaxed whitespace-pre-line">{sum.prescription}</p>
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {rxList.map((rx, i) => (
                        <div key={i} className="bg-cloud-grey rounded-xl px-4 py-3">
                          <p className="text-sm font-semibold text-ink-black">{rx.medicine}</p>
                          {rx.dosage && <p className="text-xs text-ink-black/60">{rx.dosage}{rx.duration ? ` · ${rx.duration}` : ''}</p>}
                          {rx.instructions && <p className="text-xs text-ink-black/60">{rx.instructions}</p>}
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}
            {sum.followup_recommendation && (
              <div className="p-6 print-section">
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Follow-up Recommendation</p>
                <p className="text-sm text-ink-black leading-relaxed">{sum.followup_recommendation}</p>
              </div>
            )}
            {sum.referral_needed && (
              <div className="p-6 print-section">
                <div className="bg-info/10 border border-info/20 rounded-xl px-4 py-3 text-info text-sm font-semibold">
                  📋 Doctor recommends a specialist referral{sum.referral_specialty ? ` (${sum.referral_specialty})` : ''}
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

      {/* Rating — hidden in print */}
      {!rated || editingRating ? (
        <div className="card p-6 print-hide">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">
            {existingReviewId ? 'Edit Your Rating' : 'Rate Your Doctor'}
          </h2>
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
          <div className="flex gap-3">
            {editingRating && (
              <button
                onClick={() => setEditingRating(false)}
                className="btn-outline h-10 px-6 text-sm rounded-xl"
              >
                Cancel
              </button>
            )}
            <button
              onClick={submitRating}
              disabled={!rating || submitting}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              {submitting ? 'Submitting…' : existingReviewId ? 'Update Rating →' : 'Submit Rating →'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center print-hide">
          <p className="text-3xl mb-2">🙏</p>
          <p className="font-montserrat font-bold text-ink-black">Thank you for your feedback!</p>
          <p className="text-ink-black/50 text-sm mt-1">Your review helps other patients find great doctors.</p>
          <div className="flex justify-center gap-1 mt-3 text-xl">
            {starsDisplay(rating || 5)}
          </div>
          <div className="flex justify-center gap-3 mt-4">
            <button
              onClick={() => setEditingRating(true)}
              className="btn-outline h-10 px-6 text-sm rounded-xl"
            >
              Edit Review
            </button>
            <Link href="/patient/appointments?tab=past" className="btn-primary inline-flex h-10 px-6 text-sm rounded-xl items-center">
              Back to Appointments
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
