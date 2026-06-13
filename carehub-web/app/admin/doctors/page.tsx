'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Doctor {
  id: string
  specialty: string
  years_experience: number
  status: string
  rating_average: number
  total_consultations: number
  is_online: boolean
  user: { full_name: string; email: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-success/15 text-success',
  pending: 'bg-warning/15 text-warning',
  rejected: 'bg-danger/15 text-danger',
  suspended: 'bg-steel-grey text-ink-black/60',
}

export default function AdminDoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('doctor_profiles')
        .select('*, user:users(full_name, email)')
        .order('created_at', { ascending: false })
      setDoctors((data ?? []) as unknown as Doctor[])
      setLoading(false)
    }
    load()
  }, [])

  async function toggleSuspend(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'suspended' ? 'approved' : 'suspended'
    await supabase.from('doctor_profiles').update({ status: newStatus }).eq('id', id)
    setDoctors(prev => prev.map(d => d.id === id ? { ...d, status: newStatus } : d))
  }

  const filtered = doctors.filter(d => {
    const matchesSearch = (d.user?.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      d.specialty.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || d.status === filter
    return matchesSearch && matchesFilter
  })

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">All Doctors</h1>
          <p className="text-ink-black/50 text-sm mt-1">{doctors.length} total doctors</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name or specialty…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
        />
        <div className="flex gap-2 flex-wrap">
          {['all', 'approved', 'pending', 'rejected', 'suspended'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-11 px-4 rounded-2xl text-sm font-semibold capitalize transition-colors ${
                filter === f ? 'bg-gradient-interactive text-white' : 'bg-white border border-steel-grey text-ink-black/60 hover:border-int-blue'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-steel-grey">
                {['Doctor', 'Specialty', 'Exp', 'Rating', 'Consultations', 'Status', 'Online', 'Action'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-black/40 text-sm">No doctors found.</td></tr>
              ) : filtered.map((d, i) => (
                <tr key={d.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm text-ink-black">{d.user?.full_name ?? '—'}</p>
                      <p className="text-xs text-ink-black/40">{d.user?.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-black/70">{d.specialty}</td>
                  <td className="px-4 py-3 text-sm text-ink-black/70">{d.years_experience}yr</td>
                  <td className="px-4 py-3 text-sm">
                    <span className="text-yellow-500 font-bold">★ {d.rating_average?.toFixed(1) ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-black/70">{d.total_consultations}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[d.status] ?? ''}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${d.is_online ? 'bg-success' : 'bg-steel-grey'}`} />
                  </td>
                  <td className="px-4 py-3">
                    {d.status === 'approved' || d.status === 'suspended' ? (
                      <button
                        onClick={() => toggleSuspend(d.id, d.status)}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors ${
                          d.status === 'suspended'
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-danger/10 text-danger hover:bg-danger/20'
                        }`}
                      >
                        {d.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                      </button>
                    ) : null}
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
