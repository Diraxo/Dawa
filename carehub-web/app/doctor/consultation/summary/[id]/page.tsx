'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { generateAndUploadReport, getReportSignedUrl } from '@/lib/consultationReport'
import { formatDateTime, stripDrPrefix } from '@/lib/utils'
import Link from 'next/link'

interface Prescription {
  medicine: string
  dosage: string
  duration: string
  instructions: string
}

interface SummaryData {
  id: string
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean
  referral_specialty: string | null
  report_pdf_path: string | null
  patient_name?: string
}

export default function DoctorConsultationSummaryPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()

  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [patientName, setPatientName] = useState('Patient')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [chiefComplaint, setChiefComplaint] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [referralNeeded, setReferralNeeded] = useState(false)
  const [referralSpecialty, setReferralSpecialty] = useState('')
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [prescriptionEnabled, setPrescriptionEnabled] = useState(false)

  // Follow-up reminder state
  const [reminderDate, setReminderDate] = useState('')
  const [reminderTime, setReminderTime] = useState('09:00')
  const [reminderMsg, setReminderMsg] = useState('')
  const [schedulingReminder, setSchedulingReminder] = useState(false)
  const [reminderSent, setReminderSent] = useState(false)
  const [patientId, setPatientId] = useState<string | null>(null)
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const [reportMeta, setReportMeta] = useState<{
    type: string; startedAt: string | null; doctorName: string; doctorSpecialty: string
  } | null>(null)
  // Display-only timestamp for the header line below — same started_at ??
  // scheduled_at ?? created_at priority used by the doctor/patient list
  // screens, kept separate from reportMeta.startedAt so the PDF report's
  // visitDate (out of scope for this fix) is untouched.
  const [headerDateIso, setHeaderDateIso] = useState<string | null>(null)
  const [headerType, setHeaderType] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

  useEffect(() => {
    if (!id) { setLoading(false); return }
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: consult } = await client
          .from('consultations')
          .select('id, patient_id, type, started_at, scheduled_at, created_at, patient:users!patient_id(full_name)')
          .eq('id', id)
          .maybeSingle()

        if ((consult as any)?.patient_id) setPatientId((consult as any).patient_id)
        setPatientName((consult as any)?.patient?.full_name ?? 'Patient')
        setHeaderDateIso(
          (consult as any)?.started_at ?? (consult as any)?.scheduled_at ?? (consult as any)?.created_at ?? null
        )
        setHeaderType((consult as any)?.type ?? null)

        // Get doctor profile id for reminder insert + report branding
        if (user) {
          const { data: ud } = await client.from('users').select('id, full_name').eq('clerk_id', user.id).single()
          if (ud) {
            const { data: dp } = await client.from('doctor_profiles').select('id, specialty').eq('user_id', (ud as any).id).single()
            if (dp) setDoctorProfileId((dp as any).id)
            setReportMeta({
              type: (consult as any)?.type ?? 'chat',
              startedAt: (consult as any)?.started_at ?? null,
              doctorName: (ud as any).full_name ?? user.fullName ?? 'Doctor',
              doctorSpecialty: (dp as any)?.specialty ?? '',
            })
          }
        }

        const { data } = await client
          .from('consultation_summaries')
          .select('id, chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed, referral_specialty, report_pdf_path')
          .eq('consultation_id', id)
          .maybeSingle()

        if (data) {
          const s = data as SummaryData
          s.patient_name = (consult as any)?.patient?.full_name ?? 'Patient'
          setSummary(s)
          setChiefComplaint(s.chief_complaint ?? '')
          setDiagnosis(s.diagnosis ?? '')
          setFollowUp(s.followup_recommendation ?? '')
          setReferralNeeded(s.referral_needed ?? false)
          setReferralSpecialty(s.referral_specialty ?? '')
          if (s.prescription) {
            try {
              const rx = JSON.parse(s.prescription)
              if (Array.isArray(rx) && rx.length > 0) {
                setPrescriptions(rx)
                setPrescriptionEnabled(true)
              }
            } catch {}
          }
        } else {
          setNotFound(true)
          setEditing(true)
        }
      } catch {
        setError('Could not load summary.')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const handleSave = async () => {
    if (!chiefComplaint.trim() || !diagnosis.trim()) {
      setError('Chief complaint and diagnosis are required.')
      return
    }
    if (!id) return
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const payload = {
        chief_complaint: chiefComplaint.trim(),
        diagnosis: diagnosis.trim(),
        prescription: prescriptionEnabled && prescriptions.length > 0
          ? JSON.stringify(prescriptions.filter(rx => rx.medicine.trim()))
          : null,
        followup_recommendation: followUp.trim() || null,
        referral_needed: referralNeeded,
        referral_specialty: referralNeeded && referralSpecialty.trim() ? referralSpecialty.trim() : null,
      }
      let summaryId = summary?.id
      if (summaryId) {
        const { error: updateError } = await client.from('consultation_summaries').update(payload).eq('id', summaryId)
        if (updateError) throw updateError
      } else {
        const { data: inserted, error: insertError } = await client
          .from('consultation_summaries')
          .insert({ consultation_id: id, ...payload })
          .select('id')
          .single()
        if (insertError) throw insertError
        summaryId = (inserted as any)?.id
      }
      setSummary(prev => ({
        ...(prev ?? ({} as SummaryData)),
        id: summaryId as string,
        patient_name: patientName,
        ...payload,
      }))
      setNotFound(false)
      setEditing(false)

      // Generate/regenerate the branded PDF report now that the summary is finalized.
      if (summaryId && id) {
        setGeneratingReport(true)
        try {
          const path = await generateAndUploadReport(client, id, {
            consultationId: id,
            consultationType: reportMeta?.type ?? 'chat',
            visitDate: reportMeta?.startedAt ? formatDateTime(reportMeta.startedAt) : formatDateTime(new Date().toISOString()),
            doctorName: stripDrPrefix(reportMeta?.doctorName ?? user?.fullName ?? 'Doctor'),
            doctorSpecialty: reportMeta?.doctorSpecialty ?? '',
            patientName,
            chiefComplaint: payload.chief_complaint,
            diagnosis: payload.diagnosis,
            prescription: payload.prescription ? JSON.parse(payload.prescription) : [],
            followupRecommendation: payload.followup_recommendation,
            referralNeeded: payload.referral_needed,
            referralSpecialty: payload.referral_specialty,
          })
          setSummary(prev => prev ? { ...prev, report_pdf_path: path } : prev)
        } catch {
          // Report generation is best-effort — the summary itself already saved.
        } finally {
          setGeneratingReport(false)
        }
      }
    } catch {
      setError('Could not save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadReport = async () => {
    if (!summary?.report_pdf_path) return
    const token = await getToken()
    if (!token) return
    const url = await getReportSignedUrl(getAuthClient(token), summary.report_pdf_path)
    if (url) window.open(url, '_blank')
  }

  const updateRx = (i: number, field: keyof Prescription, val: string) => {
    setPrescriptions(prev => { const next = [...prev]; next[i] = { ...next[i], [field]: val }; return next })
  }

  const scheduleReminder = async () => {
    if (!reminderDate || !patientId || !doctorProfileId) return
    setSchedulingReminder(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const remindAt = new Date(`${reminderDate}T${reminderTime}:00`).toISOString()
      await client.from('followup_reminders').insert({
        consultation_id: id,
        patient_id: patientId,
        doctor_id: doctorProfileId,
        remind_at: remindAt,
        message: reminderMsg.trim() || null,
      })
      setReminderSent(true)
      setReminderDate('')
      setReminderMsg('')
    } catch { /* silently fail */ }
    finally { setSchedulingReminder(false) }
  }

  const parsedRx: Prescription[] = (() => {
    if (!summary?.prescription) return []
    try { return JSON.parse(summary.prescription) } catch { return [] }
  })()

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading summary…</div>
      </div>
    )
  }

  if (!summary && !notFound) {
    return (
      <div className="p-8 max-w-2xl">
        <Link href="/doctor/consultations" className="text-ink-black/50 text-sm hover:text-ink-black">← Back</Link>
        <div className="card p-14 text-center mt-6">
          <p className="text-4xl mb-4">📋</p>
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No Summary Found</p>
          <p className="text-ink-black/50 text-sm">A summary hasn't been recorded for this consultation.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/doctor/consultations" className="text-ink-black/50 text-sm hover:text-ink-black">← Back</Link>
          <h1 className="font-montserrat font-black text-2xl text-ink-black">
            {notFound ? 'Add Consultation Notes' : 'Consultation Summary'}
          </h1>
        </div>
        {!editing ? (
          <div className="flex items-center gap-2">
            {generatingReport ? (
              <span className="text-ink-black/40 text-xs">Generating report…</span>
            ) : summary?.report_pdf_path ? (
              <button
                onClick={handleDownloadReport}
                className="h-9 px-4 rounded-xl border border-teal-green text-teal-green text-sm font-semibold hover:bg-teal-green/5 transition-colors flex items-center gap-2"
              >
                ⬇️ Download Report
              </button>
            ) : null}
            <button
              onClick={() => setEditing(true)}
              className="h-9 px-4 rounded-xl border border-int-blue text-int-blue text-sm font-semibold hover:bg-int-blue/5 transition-colors flex items-center gap-2"
            >
              ✏️ Edit
            </button>
          </div>
        ) : !notFound ? (
          <button
            onClick={() => setEditing(false)}
            className="h-9 px-4 rounded-xl border border-steel-grey text-ink-black/60 text-sm font-semibold hover:bg-cloud-grey transition-colors"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {/* Patient card */}
      <div
        className="rounded-2xl p-5 flex items-center gap-4 mb-6 text-white"
        style={{ background: 'linear-gradient(135deg, #2962FF, #00BFA5)' }}
      >
        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-xl">
          {(summary?.patient_name ?? patientName ?? 'P').charAt(0)}
        </div>
        <div className="flex-1">
          <p className="font-montserrat font-black text-base">{summary?.patient_name ?? patientName ?? 'Patient'}</p>
          <p className="text-white/70 text-xs mt-0.5">
            {headerType
              ? `${headerType.charAt(0).toUpperCase() + headerType.slice(1)} Consultation${headerDateIso ? ` · ${formatDateTime(headerDateIso)}` : ''}`
              : 'Completed consultation'}
          </p>
        </div>
        {summary?.referral_needed && (
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-white/20">Referral</span>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-sm text-danger font-semibold">
          {error}
        </div>
      )}

      {editing ? (
        /* Edit mode */
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">Chief Complaint *</label>
            <textarea
              value={chiefComplaint}
              onChange={e => setChiefComplaint(e.target.value)}
              placeholder="Patient's primary complaint"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue resize-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">Diagnosis *</label>
            <textarea
              value={diagnosis}
              onChange={e => setDiagnosis(e.target.value)}
              placeholder="Diagnosis / clinical findings"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue resize-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">Follow-up Recommendation</label>
            <textarea
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              placeholder="Optional follow-up instructions"
              rows={2}
              className="w-full px-4 py-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue resize-none"
            />
          </div>

          <div className="flex items-center justify-between card p-4">
            <span className="text-sm font-semibold text-ink-black">Referral Needed</span>
            <button
              onClick={() => setReferralNeeded(r => !r)}
              className={`w-12 h-6 rounded-full transition-colors relative ${referralNeeded ? 'bg-int-blue' : 'bg-steel-grey'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${referralNeeded ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {referralNeeded && (
            <div>
              <label className="block text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">Referral Specialty</label>
              <input
                value={referralSpecialty}
                onChange={e => setReferralSpecialty(e.target.value)}
                placeholder="e.g. Cardiology"
                className="w-full h-10 px-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
              />
            </div>
          )}

          <div className="flex items-center justify-between card p-4">
            <span className="text-sm font-semibold text-ink-black">Add Prescription</span>
            <button
              onClick={() => {
                setPrescriptionEnabled(v => !v)
                if (!prescriptionEnabled && prescriptions.length === 0) {
                  setPrescriptions([{ medicine: '', dosage: '', duration: '', instructions: '' }])
                }
              }}
              className={`w-12 h-6 rounded-full transition-colors relative ${prescriptionEnabled ? 'bg-teal-green' : 'bg-steel-grey'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${prescriptionEnabled ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {prescriptionEnabled && prescriptions.map((rx, i) => (
            <div key={i} className="card p-4 flex flex-col gap-3">
              <p className="text-sm font-bold text-ink-black">Medicine {i + 1}</p>
              {(['medicine', 'dosage', 'duration', 'instructions'] as const).map(f => (
                <input
                  key={f}
                  value={rx[f]}
                  onChange={e => updateRx(i, f, e.target.value)}
                  placeholder={f === 'medicine' ? 'Medicine name' : f === 'dosage' ? 'Dosage (e.g. 500mg twice daily)' : f === 'duration' ? 'Duration (e.g. 7 days)' : 'Instructions'}
                  className="h-10 px-3 rounded-lg border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                />
              ))}
              {prescriptions.length > 1 && (
                <button
                  onClick={() => setPrescriptions(p => p.filter((_, idx) => idx !== i))}
                  className="text-danger text-xs font-semibold flex items-center gap-1 mt-1"
                >
                  🗑️ Remove
                </button>
              )}
            </div>
          ))}

          {prescriptionEnabled && (
            <button
              onClick={() => setPrescriptions(p => [...p, { medicine: '', dosage: '', duration: '', instructions: '' }])}
              className="text-teal-green text-sm font-semibold flex items-center gap-2 py-2"
            >
              ＋ Add Another Medicine
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="h-13 rounded-2xl text-white font-bold text-sm disabled:opacity-60 mt-2"
            style={{ height: 52, background: saving ? '#9CA3AF' : 'linear-gradient(to right, #2962FF, #00BFA5)' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      ) : (
        /* View mode */
        <div className="flex flex-col gap-4">
          {[
            { label: 'Chief Complaint', value: summary?.chief_complaint ?? 'Not recorded' },
            { label: 'Diagnosis', value: summary?.diagnosis ?? 'Not recorded' },
            { label: 'Follow-up Recommendation', value: summary?.followup_recommendation ?? 'None' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-5">
              <p className="text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">{label}</p>
              <p className="text-sm text-ink-black leading-relaxed">{value}</p>
            </div>
          ))}

          {summary?.referral_needed && (
            <div className="flex items-center gap-3 bg-int-blue/8 border border-int-blue/20 rounded-2xl px-4 py-3">
              <span className="text-lg">↗️</span>
              <span className="text-sm font-semibold text-int-blue">
                Specialist referral recommended{summary.referral_specialty ? ` — ${summary.referral_specialty}` : ''}
              </span>
            </div>
          )}

          {parsedRx.length > 0 ? (
            <div className="card p-5">
              <p className="text-[11px] font-bold text-int-blue uppercase tracking-wider mb-3">Prescription</p>
              {parsedRx.map((rx, i) => (
                <div key={i} className={`py-3 ${i < parsedRx.length - 1 ? 'border-b border-cloud-grey' : ''}`}>
                  <p className="text-sm font-bold text-ink-black">💊 {rx.medicine}</p>
                  {rx.dosage && <p className="text-xs text-ink-black/60 mt-1">{rx.dosage}{rx.duration ? ` · ${rx.duration}` : ''}</p>}
                  {rx.instructions && <p className="text-xs text-ink-black/50 mt-0.5">{rx.instructions}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-5">
              <p className="text-[11px] font-bold text-int-blue uppercase tracking-wider mb-2">Prescription</p>
              <p className="text-sm text-ink-black/50">No prescription issued</p>
            </div>
          )}
        </div>
      )}

      {/* Follow-up Reminder */}
      <div className="card p-6 mt-6">
        <h2 className="font-montserrat font-bold text-base text-ink-black mb-1">Schedule Follow-up Reminder</h2>
        <p className="text-ink-black/40 text-xs mb-4">Patient will receive a push notification at the scheduled time.</p>
        {reminderSent ? (
          <div className="flex items-center gap-3 bg-teal-green/10 rounded-xl px-4 py-3 border border-teal-green/20">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-sm font-semibold text-teal-green">Reminder scheduled!</p>
              <button onClick={() => setReminderSent(false)} className="text-xs text-ink-black/50 underline mt-0.5">Schedule another</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-ink-black/50 uppercase tracking-wider mb-1">Date</label>
                <input
                  type="date"
                  value={reminderDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setReminderDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  aria-label="Reminder date"
                />
              </div>
              <div className="w-28">
                <label className="block text-[11px] font-bold text-ink-black/50 uppercase tracking-wider mb-1">Time</label>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  aria-label="Reminder time"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-black/50 uppercase tracking-wider mb-1">Message (optional)</label>
              <input
                type="text"
                value={reminderMsg}
                onChange={e => setReminderMsg(e.target.value)}
                placeholder="e.g. Please come back for a follow-up checkup"
                maxLength={200}
                className="w-full h-10 px-3 rounded-xl border border-steel-grey bg-cloud-grey text-sm font-montserrat text-ink-black placeholder:text-ink-black/30 focus:outline-none focus:border-int-blue"
                aria-label="Reminder message"
              />
            </div>
            <button
              onClick={scheduleReminder}
              disabled={!reminderDate || schedulingReminder}
              className="h-11 rounded-xl text-white font-montserrat font-semibold text-sm disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(to right, #2962FF, #00BFA5)' }}
              aria-label="Schedule follow-up reminder"
            >
              {schedulingReminder ? 'Scheduling…' : '📅 Schedule Reminder'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
