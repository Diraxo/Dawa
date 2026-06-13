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

  const filtered = filter === 'all' ? consultations : consultations.filter(c => c.status === filter)

  return (
    <div className="p-8">
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
                {['Type', 'Patient', 'Doctor', 'Amount', 'Status', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-black/40 text-sm">No consultations found.</td></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
