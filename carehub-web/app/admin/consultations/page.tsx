'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDateTime, parsePrescription } from '@/lib/utils'
import { MessageCircle, Phone, Video, ClipboardList, X } from 'lucide-react'

interface Consultation {
  id: string
  type: string
  status: string
  patient_amount: number
  created_at: string
  decline_reason: string | null
  declined_at: string | null
  consultation_credit: boolean
  credit_amount: number | null
  credit_used: boolean
  replacement_consultation_id: string | null
  patient: { full_name: string } | null
  doctor: { user: { full_name: string } | null } | null
  declined_by_user: { full_name: string } | null
  cancelled_by_user: { full_name: string } | null
  replacement_consultation: { doctor: { user: { full_name: string } | null } | null } | null
}

interface Summary {
  id: string
  consultation_id: string
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean | null
  referral_specialty: string | null
  created_at: string
  updated_at: string | null
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  active: 'bg-int-blue/15 text-int-blue',
  pending_payment: 'bg-warning/15 text-warning',
  waiting_for_doctor: 'bg-warning/15 text-warning',
  accepted: 'bg-teal-green/15 text-teal-green',
  in_progress: 'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-steel-grey/30 text-ink-black/60',
  declined: 'bg-danger/15 text-danger',
  missed: 'bg-danger/15 text-danger',
  call_declined: 'bg-danger/15 text-danger',
  doctor_missed: 'bg-warning/15 text-warning',
  no_show: 'bg-warning/15 text-warning',
  ended_abnormally: 'bg-danger/15 text-danger',
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

export default function AdminConsultationsPage() {
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [summaryModal, setSummaryModal] = useState<{ consultation: Consultation; summary: Summary | null } | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select(`
          id, type, status, patient_amount, created_at,
          decline_reason, declined_at, consultation_credit, credit_amount, credit_used,
          replacement_consultation_id,
          patient:users!patient_id(full_name),
          doctor:doctor_profiles!doctor_id(user:users(full_name)),
          declined_by_user:users!declined_by(full_name),
          cancelled_by_user:users!cancelled_by(full_name),
          replacement_consultation:consultations!replacement_consultation_id(doctor:doctor_profiles!doctor_id(user:users(full_name)))
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      setConsultations((data ?? []) as unknown as Consultation[])
      setLoading(false)
    }
    load()
  }, [])

  async function openSummary(consultation: Consultation) {
    setLoadingSummary(true)
    setSummaryModal({ consultation, summary: null })
    try {
      const res = await fetch(`/api/admin/consultations/${consultation.id}`)
      const data = await res.json()
      setSummaryModal({ consultation, summary: data.summary ?? null })
    } finally {
      setLoadingSummary(false)
    }
  }

  async function cancelConsultation(id: string) {
    setCancelConfirm(null)
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/consultations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setConsultations(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelled' } : c))
      showToast('Consultation cancelled — patient and doctor notified.', 'success')
    } finally {
      setProcessing(null)
    }
  }

  const filtered = filter === 'all' ? consultations : consultations.filter(c => c.status === filter)

  return (
    <div className="p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold font-montserrat transition-all ${
          toast.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Cancel confirm dialog */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <p className="font-montserrat font-bold text-lg text-ink-black mb-2">Cancel this consultation?</p>
            <p className="text-ink-black/60 text-sm mb-6">
              The patient and doctor will both be notified. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelConfirm(null)}
                className="flex-1 h-11 rounded-2xl border border-steel-grey text-sm font-semibold text-ink-black/70 hover:bg-cloud-grey"
              >
                Keep it
              </button>
              <button
                onClick={() => cancelConsultation(cancelConfirm)}
                className="flex-1 h-11 rounded-2xl bg-danger text-white text-sm font-bold hover:bg-red-700 transition-colors"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary modal */}
      {summaryModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSummaryModal(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-montserrat font-bold text-lg text-ink-black">Consultation Summary</h2>
              <button
                onClick={() => setSummaryModal(null)}
                className="w-8 h-8 rounded-full bg-cloud-grey hover:bg-steel-grey flex items-center justify-center text-ink-black/50 text-lg"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5 text-xs">
              <div>
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Doctor</p>
                <p className="font-semibold text-ink-black">{summaryModal.consultation.doctor?.user?.full_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Patient</p>
                <p className="font-semibold text-ink-black">{summaryModal.consultation.patient?.full_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Type</p>
                <p className="font-semibold text-ink-black capitalize flex items-center gap-1.5">
                  {(() => { const I = TYPE_ICONS[summaryModal.consultation.type] ?? ClipboardList; return <I size={16} /> })()} {summaryModal.consultation.type}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Date</p>
                <p className="font-semibold text-ink-black">{formatDateTime(summaryModal.consultation.created_at)}</p>
              </div>
            </div>

            {/* Decline / cancel audit trail */}
            {(summaryModal.consultation.decline_reason ||
              summaryModal.consultation.cancelled_by_user ||
              summaryModal.consultation.declined_by_user ||
              summaryModal.consultation.replacement_consultation_id) && (
              <div className="mb-5 rounded-2xl border border-steel-grey/60 bg-cloud-grey/50 p-4 text-xs flex flex-col gap-2">
                <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">
                  Decline / Cancellation
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-ink-black/50">Status</span>
                  <span className="font-semibold text-ink-black capitalize">{summaryModal.consultation.status.replace(/_/g, ' ')}</span>

                  {summaryModal.consultation.declined_by_user && (
                    <>
                      <span className="text-ink-black/50">Declined by</span>
                      <span className="font-semibold text-ink-black">Dr. {summaryModal.consultation.declined_by_user.full_name}</span>
                    </>
                  )}
                  {summaryModal.consultation.decline_reason && (
                    <>
                      <span className="text-ink-black/50">Reason</span>
                      <span className="font-semibold text-ink-black">{summaryModal.consultation.decline_reason}</span>
                    </>
                  )}
                  {summaryModal.consultation.declined_at && (
                    <>
                      <span className="text-ink-black/50">Declined at</span>
                      <span className="font-semibold text-ink-black">{formatDateTime(summaryModal.consultation.declined_at)}</span>
                    </>
                  )}
                  {summaryModal.consultation.cancelled_by_user && (
                    <>
                      <span className="text-ink-black/50">Cancelled by</span>
                      <span className="font-semibold text-ink-black">{summaryModal.consultation.cancelled_by_user.full_name}</span>
                    </>
                  )}
                  {summaryModal.consultation.consultation_credit && (
                    <>
                      <span className="text-ink-black/50">Credit</span>
                      <span className="font-semibold text-ink-black">
                        ETB {Number(summaryModal.consultation.credit_amount ?? 0).toFixed(2)}
                        {summaryModal.consultation.credit_used ? ' · used' : ' · unused'}
                      </span>
                    </>
                  )}
                  {summaryModal.consultation.replacement_consultation?.doctor?.user?.full_name && (
                    <>
                      <span className="text-ink-black/50">Replacement doctor</span>
                      <span className="font-semibold text-ink-black">Dr. {summaryModal.consultation.replacement_consultation.doctor.user.full_name}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {loadingSummary ? (
              <div className="py-12 text-center text-ink-black/40 text-sm">Loading summary…</div>
            ) : !summaryModal.summary ? (
              <div className="py-12 text-center">
                <ClipboardList size={40} className="mx-auto mb-3 text-steel-grey" />
                <p className="text-ink-black/50 text-sm">No summary has been written for this consultation yet.</p>
                <p className="text-ink-black/30 text-xs mt-1">The doctor fills the summary after ending the session.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <SummaryField label="Chief Complaint" value={summaryModal.summary.chief_complaint} />
                <SummaryField label="Diagnosis" value={summaryModal.summary.diagnosis} />
                <PrescriptionField value={summaryModal.summary.prescription} />
                <SummaryField label="Follow-up Recommendation" value={summaryModal.summary.followup_recommendation} />
                <div>
                  <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">Referral Needed</p>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    summaryModal.summary.referral_needed ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                  }`}>
                    {summaryModal.summary.referral_needed ? 'Yes' : 'No'}
                  </span>
                  {summaryModal.summary.referral_specialty && (
                    <span className="ml-2 text-xs text-ink-black/60">{summaryModal.summary.referral_specialty}</span>
                  )}
                </div>
                <p className="text-[11px] text-ink-black/30 pt-1 border-t border-steel-grey/40">
                  Submitted {formatDateTime(summaryModal.summary.created_at)}
                  {summaryModal.summary.updated_at && summaryModal.summary.updated_at !== summaryModal.summary.created_at
                    ? ` · Last edited ${formatDateTime(summaryModal.summary.updated_at)}`
                    : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">All Consultations</h1>
        <p className="text-ink-black/50 text-sm mt-1">{consultations.length} total (last 100)</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {['all', 'waiting_for_doctor', 'accepted', 'in_progress', 'completed', 'declined', 'cancelled', 'missed', 'call_declined'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-9 px-4 rounded-2xl text-sm font-semibold capitalize transition-colors ${
              filter === f ? 'bg-gradient-interactive text-white' : 'bg-white border border-steel-grey text-ink-black/60 hover:border-int-blue'
            }`}
          >
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-steel-grey">
                {['Type', 'Patient', 'Doctor', 'Amount', 'Status', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-black/40 text-sm">No consultations found.</td></tr>
              ) : filtered.map((c, i) => (
                <tr key={c.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {(() => { const I = TYPE_ICONS[c.type] ?? ClipboardList; return <I size={16} className="text-ink-black/60" /> })()}
                      <span className="text-xs font-semibold text-ink-black/60 capitalize">{c.type}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-black">{c.patient?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-black">{c.doctor?.user?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-ink-black">
                    {c.patient_amount ? `ETB ${c.patient_amount}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[c.status] ?? ''}`}>
                      {c.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-black/50">{formatDateTime(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openSummary(c)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-int-blue/10 text-int-blue border border-int-blue/20 font-semibold hover:bg-int-blue/20 transition-colors inline-flex items-center gap-1"
                      >
                        <ClipboardList size={13} /> Summary
                      </button>
                      {['pending', 'active', 'pending_payment', 'waiting_for_doctor', 'accepted', 'in_progress'].includes(c.status) && (
                        <button
                          onClick={() => setCancelConfirm(c.id)}
                          disabled={processing === c.id}
                          className="text-xs px-2.5 py-1 rounded-lg bg-danger/10 text-danger border border-danger/20 font-semibold hover:bg-danger/20 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {processing === c.id ? '…' : <><X size={13} /> Cancel</>}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">{label}</p>
      {value ? (
        <p className="text-sm text-ink-black bg-cloud-grey rounded-xl px-3 py-2 leading-relaxed">{value}</p>
      ) : (
        <p className="text-sm text-ink-black/30 italic">Not provided</p>
      )}
    </div>
  )
}

function PrescriptionField({ value }: { value: string | null | undefined }) {
  const rxList = value ? parsePrescription(value) : null
  return (
    <div>
      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">Prescription</p>
      {!value ? (
        <p className="text-sm text-ink-black/30 italic">Not provided</p>
      ) : rxList ? (
        <div className="flex flex-col gap-1.5">
          {rxList.map((rx, i) => (
            <div key={i} className="bg-cloud-grey rounded-xl px-3 py-2">
              <p className="text-sm font-semibold text-ink-black">{rx.medicine}</p>
              {rx.dosage && <p className="text-xs text-ink-black/60">{rx.dosage}{rx.duration ? ` · ${rx.duration}` : ''}</p>}
              {rx.instructions && <p className="text-xs text-ink-black/60">{rx.instructions}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-black bg-cloud-grey rounded-xl px-3 py-2 leading-relaxed">{value}</p>
      )}
    </div>
  )
}
