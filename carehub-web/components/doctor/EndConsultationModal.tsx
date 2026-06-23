'use client'

import { useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { getStreamClient } from '@/lib/stream'

interface Prescription {
  medicine: string
  dosage: string
  duration: string
  instructions: string
}

interface Props {
  consultationId: string
  patientName: string
  elapsedSeconds?: number
  onDone: () => void
  onClose: () => void
}

const BLANK_RX: Prescription = { medicine: '', dosage: '', duration: '', instructions: '' }

export function EndConsultationModal({ consultationId, patientName, elapsedSeconds, onDone, onClose }: Props) {
  const { getToken } = useAuth()
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [prescriptionEnabled, setPrescriptionEnabled] = useState(false)
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([{ ...BLANK_RX }])
  const [followUp, setFollowUp] = useState('')
  const [referralNeeded, setReferralNeeded] = useState(false)
  const [referralSpecialty, setReferralSpecialty] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isValid = chiefComplaint.trim().length > 0 && diagnosis.trim().length > 0

  function updatePrescription(index: number, field: keyof Prescription, value: string) {
    setPrescriptions(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  async function handleSubmit() {
    if (!isValid) return
    setSubmitting(true)
    const token = await getToken()
    if (!token) { setSubmitting(false); return }
    const client = getAuthClient(token)

    const prescriptionText = prescriptionEnabled
      ? prescriptions
          .filter(rx => rx.medicine.trim())
          .map(rx => `${rx.medicine} — ${rx.dosage}, ${rx.duration}. ${rx.instructions}`.trim())
          .join('\n')
      : null

    await client.from('consultation_summaries').insert({
      consultation_id: consultationId,
      chief_complaint: chiefComplaint.trim(),
      diagnosis: diagnosis.trim(),
      prescription: prescriptionText,
      followup_recommendation: followUp.trim() || null,
      referral_needed: referralNeeded,
      referral_specialty: referralNeeded && referralSpecialty.trim() ? referralSpecialty.trim() : null,
    })

    await client.from('consultations').update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_minutes: elapsedSeconds ? Math.ceil(elapsedSeconds / 60) : null,
    }).eq('id', consultationId)

    try {
      const stream = getStreamClient()
      const ch = stream.channel('messaging', consultationId)
      await ch.updatePartial({ set: { consultationStatus: 'completed' } as object })
    } catch {}

    // Notify patient that the summary is ready
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      await fetch(`${supabaseUrl}/functions/v1/handle-consultation-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event: 'summary_ready', consultation_id: consultationId }),
      })
    } catch {}

    setSubmitting(false)
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-montserrat font-bold text-xl text-ink-black">End Consultation</h2>
              <p className="text-ink-black/50 text-sm mt-0.5">Fill in notes for {patientName}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-cloud-grey flex items-center justify-center text-ink-black/50 hover:bg-steel-grey transition-colors text-sm"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* Chief Complaint */}
            <div>
              <label className="block text-sm font-semibold text-ink-black mb-1.5">
                Chief Complaint <span className="text-danger">*</span>
              </label>
              <textarea
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                placeholder="What did the patient report?"
                rows={3}
                className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue resize-none"
              />
            </div>

            {/* Diagnosis */}
            <div>
              <label className="block text-sm font-semibold text-ink-black mb-1.5">
                Diagnosis <span className="text-danger">*</span>
              </label>
              <textarea
                value={diagnosis}
                onChange={e => setDiagnosis(e.target.value)}
                placeholder="Your diagnosis"
                rows={3}
                className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue resize-none"
              />
            </div>

            {/* Prescription toggle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-ink-black">Add Prescription</label>
                <button
                  type="button"
                  onClick={() => setPrescriptionEnabled(p => !p)}
                  className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                    prescriptionEnabled ? 'bg-teal-green' : 'bg-steel-grey'
                  }`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    prescriptionEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              {prescriptionEnabled && (
                <div className="bg-cloud-grey rounded-2xl p-4 flex flex-col gap-3">
                  {prescriptions.map((rx, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <input
                        value={rx.medicine}
                        onChange={e => updatePrescription(i, 'medicine', e.target.value)}
                        placeholder="Medicine name"
                        className="rounded-xl border border-steel-grey bg-white px-3 py-2 text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={rx.dosage}
                          onChange={e => updatePrescription(i, 'dosage', e.target.value)}
                          placeholder="Dosage"
                          className="rounded-xl border border-steel-grey bg-white px-3 py-2 text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
                        />
                        <input
                          value={rx.duration}
                          onChange={e => updatePrescription(i, 'duration', e.target.value)}
                          placeholder="Duration (e.g. 7 days)"
                          className="rounded-xl border border-steel-grey bg-white px-3 py-2 text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
                        />
                      </div>
                      <input
                        value={rx.instructions}
                        onChange={e => updatePrescription(i, 'instructions', e.target.value)}
                        placeholder="Instructions (e.g. Take after meals)"
                        className="rounded-xl border border-steel-grey bg-white px-3 py-2 text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPrescriptions(prev => [...prev, { ...BLANK_RX }])}
                    className="text-teal-green text-sm font-semibold hover:underline text-left"
                  >
                    + Add Another Medicine
                  </button>
                </div>
              )}
            </div>

            {/* Follow-up */}
            <div>
              <label className="block text-sm font-semibold text-ink-black mb-1.5">Follow-up Recommendation</label>
              <textarea
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                placeholder="e.g. Return in 2 weeks if symptoms persist"
                rows={2}
                className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue resize-none"
              />
            </div>

            {/* Referral */}
            <div>
              <label className="block text-sm font-semibold text-ink-black mb-2">Referral Needed?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReferralNeeded(true)}
                  className={`h-9 px-5 rounded-2xl text-sm font-semibold transition-colors ${
                    referralNeeded ? 'bg-teal-green text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey'
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setReferralNeeded(false)}
                  className={`h-9 px-5 rounded-2xl text-sm font-semibold transition-colors ${
                    !referralNeeded ? 'bg-teal-green text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey'
                  }`}
                >
                  No
                </button>
              </div>
              {referralNeeded && (
                <input
                  value={referralSpecialty}
                  onChange={e => setReferralSpecialty(e.target.value)}
                  placeholder="Specify specialty (e.g. Cardiology)"
                  className="mt-2 w-full rounded-xl border border-steel-grey bg-cloud-grey px-3 py-2 text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
                />
              )}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="btn-primary w-full mt-6 disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Submit & End Consultation →'}
          </button>
        </div>
      </div>
    </div>
  )
}
