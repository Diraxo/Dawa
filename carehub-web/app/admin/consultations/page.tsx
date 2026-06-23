'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'

interface Consultation {
  id: string
  type: string
  status: string
  patient_amount: number
  created_at: string
  patient: { full_name: string } | null
  doctor: { user: { full_name: string } | null } | null
}

interface Summary {
  id: string
  consultation_id: string
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  active: 'bg-int-blue/15 text-int-blue',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-danger/15 text-danger',
}

const TYPE_ICONS: Record<string, string> = { chat: '💬', phone: '📞', video: '🎥' }

export default function AdminConsultationsPage() {
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [summaryModal, setSummaryModal] = useState<{ consultationId: string; summary: Summary | null } | null>(null)
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
        .select('id, type, status, patient_amount, created_at, patient:users!patient_id(full_name), doctor:doctor_profiles!doctor_id(user:users(full_name))')
        .order('created_at', { ascending: false })
        .limit(100)
      setConsultations((data ?? []) as unknown as Consultation[])
      setLoading(false)
    }
    load()
  }, [])

  async function openSummary(consultationId: string) {
    setLoadingSummary(true)
    setSummaryModal({ consultationId, summary: null })
    try {
      const res = await fetch(`/api/admin/consultations/${consultationId}`)
      const data = await res.json()
      setSummaryModal({ consultationId, summary: data.summary ?? null })
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

            {loadingSummary ? (
              <div className="py-12 text-center text-ink-black/40 text-sm">Loading summary…</div>
            ) : !summaryModal.summary ? (
              <div className="py-12 text-center">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-ink-black/50 text-sm">No summary has been written for this consultation yet.</p>
                <p className="text-ink-black/30 text-xs mt-1">The doctor fills the summary after ending the session.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <SummaryField label="Chief Complaint" value={summaryModal.summary.chief_complaint} />
                <SummaryField label="Diagnosis" value={summaryModal.summary.diagnosis} />
                <SummaryField label="Prescription" value={summaryModal.summary.prescription} />
                <SummaryField label="Follow-up Recommendation" value={summaryModal.summary.followup_recommendation} />
                <div>
                  <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">Referral Needed</p>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    summaryModal.summary.referral_needed ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                  }`}>
                    {summaryModal.summary.referral_needed ? 'Yes' : 'No'}
                  </span>
                </div>
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
        {['all', 'pending', 'active', 'completed', 'cancelled'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-9 px-4 rounded-2xl text-sm font-semibold capitalize transition-colors ${
              filter === f ? 'bg-gradient-interactive text-white' : 'bg-white border border-steel-grey text-ink-black/60 hover:border-int-blue'
            }`}
          >
            {f}
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
                    <span className="text-lg">{TYPE_ICONS[c.type] ?? '📋'}</span>
                    <span className="ml-2 text-xs font-semibold text-ink-black/60 capitalize">{c.type}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-black">{c.patient?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-black">{c.doctor?.user?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-ink-black">
                    {c.patient_amount ? `ETB ${c.patient_amount}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[c.status] ?? ''}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-black/50">{formatDateTime(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openSummary(c.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-int-blue/10 text-int-blue border border-int-blue/20 font-semibold hover:bg-int-blue/20 transition-colors"
                      >
                        📋 Summary
                      </button>
                      {(c.status === 'pending' || c.status === 'active') && (
                        <button
                          onClick={() => setCancelConfirm(c.id)}
                          disabled={processing === c.id}
                          className="text-xs px-2.5 py-1 rounded-lg bg-danger/10 text-danger border border-danger/20 font-semibold hover:bg-danger/20 transition-colors disabled:opacity-50"
                        >
                          {processing === c.id ? '…' : '✕ Cancel'}
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
