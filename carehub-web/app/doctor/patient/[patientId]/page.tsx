'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import Link from 'next/link'
import { MessageCircle, Phone, Video, ClipboardList, Pill } from 'lucide-react'

interface HistoryEntry {
  consultationId: string
  type: 'chat' | 'phone' | 'video'
  date: string | null
  chiefComplaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup: string | null
  referralNeeded: boolean
  durationMinutes: number | null
}

interface PatientInfo {
  fullName: string
  email: string | null
  photoUrl: string | null
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

function parsePrescription(raw: string | null): Array<{ medicine: string; dosage?: string; duration?: string }> {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export default function DoctorPatientHistoryPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const { getToken }   = useAuth()

  const [history,    setHistory]    = useState<HistoryEntry[]>([])
  const [patient,    setPatient]    = useState<PatientInfo | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [expanded,   setExpanded]   = useState<string | null>(null)

  useEffect(() => {
    if (!patientId) { setLoading(false); return }
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const [{ data: patientData }, { data: historyData }] = await Promise.all([
          client
            .from('users')
            .select('full_name, email, profile_photo_url')
            .eq('id', patientId)
            .maybeSingle(),
          client
            .from('consultations')
            .select(`
              id, type, ended_at, duration_minutes,
              consultation_summaries!inner(
                chief_complaint, diagnosis, prescription,
                followup_recommendation, referral_needed
              )
            `)
            .eq('patient_id', patientId)
            .eq('status', 'completed')
            .order('ended_at', { ascending: false })
            .limit(50),
        ])

        if (patientData) {
          setPatient({
            fullName: (patientData as any).full_name ?? 'Patient',
            email:    (patientData as any).email ?? null,
            photoUrl: (patientData as any).profile_photo_url ?? null,
          })
        }

        if (historyData) {
          setHistory((historyData as any[]).map(r => {
            const s = Array.isArray(r.consultation_summaries) ? r.consultation_summaries[0] : r.consultation_summaries
            return {
              consultationId: r.id,
              type: r.type ?? 'chat',
              date: r.ended_at,
              chiefComplaint: s?.chief_complaint ?? null,
              diagnosis:      s?.diagnosis ?? null,
              prescription:   s?.prescription ?? null,
              followup:       s?.followup_recommendation ?? null,
              referralNeeded: s?.referral_needed ?? false,
              durationMinutes: r.duration_minutes ?? null,
            }
          }))
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    })()
  }, [patientId])

  const totalReferrals    = history.filter(h => h.referralNeeded).length
  const totalPrescriptions = history.filter(h => h.prescription).length

  return (
    <div className="p-8 max-w-3xl">
      {/* Back */}
      <Link href="/doctor/consultations" className="text-ink-black/50 text-sm hover:text-ink-black mb-6 inline-block">
        ← Back to Consultations
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        {patient?.photoUrl ? (
          <img src={patient.photoUrl} alt={patient.fullName} className="w-14 h-14 rounded-full object-cover" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-interactive flex items-center justify-center text-white font-black text-2xl">
            {patient?.fullName?.charAt(0) ?? '?'}
          </div>
        )}
        <div>
          <h1 className="font-montserrat font-black text-2xl text-ink-black">{patient?.fullName ?? 'Patient'}</h1>
          {patient?.email && <p className="text-ink-black/40 text-sm">{patient.email}</p>}
          <p className="text-ink-black/40 text-xs mt-0.5">Medical History</p>
        </div>
      </div>

      {/* Stats banner */}
      {!loading && history.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Consultations',  value: history.length,       color: 'text-care-blue',   bg: 'bg-care-blue/8'   },
            { label: 'Referrals',      value: totalReferrals,       color: 'text-warning',     bg: 'bg-warning/8'     },
            { label: 'Prescriptions',  value: totalPrescriptions,   color: 'text-teal-green',  bg: 'bg-teal-green/8'  },
          ].map(s => (
            <div key={s.label} className={`rounded-2xl p-4 text-center ${s.bg}`}>
              <p className={`font-montserrat font-black text-2xl ${s.color}`}>{s.value}</p>
              <p className="text-ink-black/50 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* History list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 shimmer-bg rounded-2xl" />)}
        </div>
      ) : history.length === 0 ? (
        <div className="card p-14 text-center">
          <ClipboardList size={40} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black">No History Yet</p>
          <p className="text-ink-black/40 text-sm mt-1">Past consultations with summaries will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map(entry => {
            const isExpanded = expanded === entry.consultationId
            const rxList     = parsePrescription(entry.prescription)
            const TypeIcon = TYPE_ICONS[entry.type] ?? MessageCircle
            return (
              <div key={entry.consultationId} className="card overflow-hidden">
                <button
                  className="w-full p-5 flex items-center gap-3 text-left hover:bg-cloud-grey/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : entry.consultationId)}
                >
                  <div className="w-10 h-10 rounded-xl bg-cloud-grey flex items-center justify-center flex-shrink-0">
                    <TypeIcon size={18} className="text-ink-black/60" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-montserrat font-semibold text-sm text-ink-black truncate">
                      {entry.chiefComplaint ?? 'No complaint recorded'}
                    </p>
                    <p className="text-ink-black/40 text-xs mt-0.5">
                      {entry.date
                        ? new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Unknown date'}
                      {entry.durationMinutes ? ` · ${entry.durationMinutes} min` : ''}
                      {` · ${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {entry.referralNeeded && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-care-blue/10 text-care-blue">Referral</span>
                    )}
                    {rxList.length > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-green/10 text-teal-green">Rx</span>
                    )}
                    <span className="text-ink-black/30 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-cloud-grey flex flex-col gap-3 pt-4">
                    {[
                      { label: 'Diagnosis',      value: entry.diagnosis ?? 'Not recorded' },
                      entry.followup ? { label: 'Follow-up', value: entry.followup } : null,
                    ].filter(Boolean).map(row => (
                      <div key={row!.label}>
                        <p className="text-[10px] font-bold text-care-blue uppercase tracking-wider mb-1">{row!.label}</p>
                        <p className="text-sm text-ink-black/70 leading-relaxed">{row!.value}</p>
                      </div>
                    ))}

                    {rxList.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-teal-green uppercase tracking-wider mb-2">Prescription</p>
                        <div className="flex flex-col gap-1.5">
                          {rxList.map((rx, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <Pill size={14} className="mt-0.5 text-teal-green" />
                              <div>
                                <p className="text-sm font-semibold text-ink-black">{rx.medicine}</p>
                                {(rx.dosage || rx.duration) && (
                                  <p className="text-xs text-ink-black/50">{rx.dosage}{rx.duration ? ` · ${rx.duration}` : ''}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Link
                        href={`/doctor/consultation/summary/${entry.consultationId}`}
                        className="text-xs font-semibold text-care-blue underline hover:opacity-80"
                      >
                        View Full Summary →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
