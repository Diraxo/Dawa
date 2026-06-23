'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { formatDate, getInitials } from '@/lib/utils'

interface Patient {
  id: string
  full_name: string
  email: string
  country: string
  created_at: string
  profile_photo_url: string | null
  is_suspended: boolean
}

export default function AdminPatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email, country, created_at, profile_photo_url, is_suspended')
        .eq('role', 'patient')
        .order('created_at', { ascending: false })
      setPatients((data ?? []) as unknown as Patient[])
      setLoading(false)
    }
    load()
  }, [])

  async function toggleSuspend(patient: Patient) {
    const action = patient.is_suspended ? 'unsuspend' : 'suspend'
    setProcessing(patient.id)
    try {
      const res = await fetch(`/api/admin/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setPatients(prev => prev.map(p =>
        p.id === patient.id ? { ...p, is_suspended: data.is_suspended } : p
      ))
      showToast(
        action === 'suspend' ? 'Patient suspended and notified.' : 'Patient unsuspended and notified.',
        'success'
      )
    } finally {
      setProcessing(null)
    }
  }

  const filtered = patients.filter(p =>
    (p.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  )

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

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <Image
              src={lightboxUrl}
              alt="Patient photo"
              width={500}
              height={500}
              className="w-full rounded-2xl object-cover shadow-2xl"
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-3 right-3 w-8 h-8 bg-white/20 hover:bg-white/40 rounded-full text-white flex items-center justify-center text-lg transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}

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
                {['Photo', 'Name', 'Email', 'Country', 'Joined', 'Status', 'Action'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-black/40 text-sm">No patients found.</td></tr>
              ) : filtered.map((p, i) => {
                const name = p.full_name || '—'
                const photoUrl = p.profile_photo_url ?? null

                return (
                  <tr key={p.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                    <td className="px-4 py-3">
                      {photoUrl ? (
                        <button
                          onClick={() => setLightboxUrl(photoUrl)}
                          className="block w-10 h-10 rounded-full overflow-hidden ring-2 ring-steel-grey hover:ring-int-blue transition-all hover:scale-110 focus:outline-none"
                          title="View photo"
                        >
                          <Image src={photoUrl} alt={name} width={40} height={40} className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-green to-emerald-400 flex items-center justify-center text-white text-xs font-bold">
                          {getInitials(name)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-sm text-ink-black">{name}</td>
                    <td className="px-4 py-3 text-sm text-ink-black/60">{p.email}</td>
                    <td className="px-4 py-3 text-sm text-ink-black/60">{p.country || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-black/60">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                        p.is_suspended
                          ? 'bg-danger/10 text-danger'
                          : 'bg-success/15 text-success'
                      }`}>
                        {p.is_suspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleSuspend(p)}
                        disabled={processing === p.id}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50 ${
                          p.is_suspended
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-danger/10 text-danger hover:bg-danger/20'
                        }`}
                      >
                        {processing === p.id ? '…' : p.is_suspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
