'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

interface Patient {
  id: string
  full_name: string
  email: string
  country: string
  created_at: string
}

export default function AdminPatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email, country, created_at')
        .eq('role', 'patient')
        .order('created_at', { ascending: false })
      setPatients(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = patients.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">All Patients</h1>
        <p className="text-ink-black/50 text-sm mt-1">{patients.length} registered patients</p>
      </div>

      <div className="mb-5">
        <input
          type="text"
          placeholder="Search patients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-steel-grey">
                {['Name', 'Email', 'Country', 'Joined'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-black/40 text-sm">No patients found.</td></tr>
              ) : filtered.map((p, i) => (
                <tr key={p.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                  <td className="px-4 py-3 font-semibold text-sm text-ink-black">{p.full_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-black/60">{p.email}</td>
                  <td className="px-4 py-3 text-sm text-ink-black/60">{p.country || '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-black/60">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
