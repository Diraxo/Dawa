'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import Link from 'next/link'
import { MessageCircle, Phone, Video, ClipboardList } from 'lucide-react'

interface SummaryRow {
  consultationId: string
  type: 'chat' | 'phone' | 'video'
  endedAt: string | null
  patientName: string | null
  chiefComplaint: string | null
  diagnosis: string | null
  referralNeeded: boolean
  hasPrescription: boolean
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }

export default function DoctorSummariesPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: ud } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!ud) return
        const { data: dp } = await client.from('doctor_profiles').select('id').eq('user_id', (ud as any).id).single()
        if (!dp) return

        const { data } = await client
          .from('consultations')
          .select(`
            id, type, ended_at,
            patient:users!patient_id(full_name),
            consultation_summaries!inner(
              chief_complaint, diagnosis, prescription, referral_needed
            )
          `)
          .eq('doctor_id', (dp as any).id)
          .eq('status', 'completed')
          .order('ended_at', { ascending: false })
          .limit(200)

        setRows((data ?? []).map((c: any) => {
          const s = Array.isArray(c.consultation_summaries)
            ? c.consultation_summaries[0]
            : c.consultation_summaries
          let hasPrescription = false
          if (s?.prescription) {
            try { hasPrescription = JSON.parse(s.prescription)?.length > 0 } catch {}
          }
          return {
            consultationId: c.id,
            type: c.type ?? 'chat',
            endedAt: c.ended_at,
            patientName: c.patient?.full_name ?? null,
            chiefComplaint: s?.chief_complaint ?? null,
            diagnosis: s?.diagnosis ?? null,
            referralNeeded: s?.referral_needed ?? false,
            hasPrescription,
          }
        }))
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const filtered = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (r.patientName ?? '').toLowerCase().includes(q) ||
      (r.chiefComplaint ?? '').toLowerCase().includes(q) ||
      (r.diagnosis ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">My Summaries</h1>
          <p className="text-ink-black/50 text-sm mt-1">{rows.length} completed consultations with summaries</p>
        </div>
        <input
          type="text"
          placeholder="Search patient, complaint, diagnosis…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 px-4 rounded-xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/30 focus:outline-none focus:border-int-blue w-72"
        />
      </div>

      {/* Quick stats */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Summaries',  value: rows.length,                              bg: 'bg-care-blue/8',   color: 'text-care-blue'  },
            { label: 'With Prescriptions', value: rows.filter(r => r.hasPrescription).length, bg: 'bg-teal-green/8', color: 'text-teal-green' },
            { label: 'With Referrals',   value: rows.filter(r => r.referralNeeded).length, bg: 'bg-warning/8',    color: 'text-warning'    },
          ].map(s => (
            <div key={s.label} className={`rounded-2xl p-4 text-center ${s.bg}`}>
              <p className={`font-montserrat font-black text-2xl ${s.color}`}>{s.value}</p>
              <p className="text-ink-black/50 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 shimmer-bg rounded-3xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <ClipboardList size={40} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black">
            {search ? 'No results found' : 'No Summaries Yet'}
          </p>
          <p className="text-ink-black/40 text-sm mt-1">
            {search ? 'Try a different search term.' : 'Summaries appear here after completing consultations.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(row => {
            const TypeIcon = TYPE_ICONS[row.type] ?? ClipboardList
            return (
            <div key={row.consultationId} className="card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-interactive flex items-center justify-center flex-shrink-0">
                <TypeIcon size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-montserrat font-bold text-sm text-ink-black">
                    {row.patientName ?? 'Patient'}
                  </p>
                  {row.referralNeeded && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-care-blue/10 text-care-blue">Referral</span>
                  )}
                  {row.hasPrescription && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-green/10 text-teal-green">Rx</span>
                  )}
                </div>
                <p className="text-ink-black/60 text-xs mt-0.5 truncate">
                  {row.chiefComplaint ?? 'No complaint recorded'}
                </p>
                {row.diagnosis && (
                  <p className="text-ink-black/40 text-xs truncate">{row.diagnosis}</p>
                )}
                <p className="text-ink-black/30 text-xs mt-0.5">
                  {row.endedAt
                    ? new Date(row.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Date unknown'}
                  {' · '}
                  {row.type.charAt(0).toUpperCase() + row.type.slice(1)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <Link
                  href={`/doctor/consultation/summary/${row.consultationId}`}
                  className="h-8 px-4 rounded-xl bg-gradient-interactive text-white text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  View →
                </Link>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
