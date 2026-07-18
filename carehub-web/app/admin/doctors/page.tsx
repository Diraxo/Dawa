'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { getInitials } from '@/lib/utils'

interface Doctor {
  id: string
  specialty: string
  years_experience: number
  status: string
  rating_average: number
  total_consultations: number
  is_online: boolean
  documents_update_allowed: boolean
  document_review_status: string
  user: { full_name: string; email: string; profile_photo_url: string | null } | null
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('doctor_profiles')
      .select('*, user:users(full_name, email, profile_photo_url)')
      .order('created_at', { ascending: false })
    setDoctors((data ?? []) as unknown as Doctor[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()

    const channel = supabase
      .channel('admin-doctors-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doctor_profiles' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function toggleSuspend(id: string, currentStatus: string) {
    const action = currentStatus === 'suspended' ? 'reinstate' : 'suspend'
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/doctors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setDoctors(prev => prev.map(d => d.id === id ? { ...d, status: data.status } : d))
      showToast(
        action === 'suspend' ? 'Doctor suspended and notified.' : 'Doctor reinstated and notified.',
        'success'
      )
    } finally {
      setProcessing(null)
    }
  }

  async function toggleDocumentUpdate(id: string, currentlyAllowed: boolean) {
    const action = currentlyAllowed ? 'disable_document_update' : 'enable_document_update'
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/doctors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setDoctors(prev => prev.map(d => d.id === id ? { ...d, documents_update_allowed: data.documentsUpdateAllowed } : d))
      showToast(data.documentsUpdateAllowed ? 'Document updates enabled for this doctor.' : 'Document updates disabled.', 'success')
    } finally {
      setProcessing(null)
    }
  }

  async function reviewDocumentUpdate(id: string, approve: boolean) {
    const action = approve ? 'approve_document_update' : 'reject_document_update'
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/doctors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setDoctors(prev => prev.map(d => d.id === id ? { ...d, document_review_status: data.documentReviewStatus } : d))
      showToast(approve ? 'Document update approved. Doctor notified.' : 'Document update rejected. Doctor notified.', 'success')
    } finally {
      setProcessing(null)
    }
  }

  const filtered = doctors.filter(d => {
    const matchesSearch = (d.user?.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      d.specialty.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || d.status === filter
    return matchesSearch && matchesFilter
  })

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
              alt="Doctor photo"
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
                {['Photo', 'Doctor', 'Specialty', 'Exp', 'Rating', 'Consultations', 'Status', 'Online', 'Docs', 'Action'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-ink-black/40 text-sm">No doctors found.</td></tr>
              ) : filtered.map((d, i) => {
                const name = d.user?.full_name ?? '—'
                const photoUrl = d.user?.profile_photo_url ?? null

                return (
                  <tr key={d.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
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
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white text-xs font-bold">
                          {getInitials(name)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-semibold text-sm text-ink-black">{name}</p>
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
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() => toggleDocumentUpdate(d.id, d.documents_update_allowed)}
                          disabled={processing === d.id}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
                            d.documents_update_allowed ? 'bg-success/15 text-success' : 'bg-steel-grey text-ink-black/50'
                          }`}
                          title="Toggle whether this doctor can re-upload documents"
                        >
                          Update: {d.documents_update_allowed ? 'On' : 'Off'}
                        </button>
                        {d.document_review_status === 'pending' && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => reviewDocumentUpdate(d.id, true)}
                              disabled={processing === d.id}
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-success/10 text-success hover:bg-success/20 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => reviewDocumentUpdate(d.id, false)}
                              disabled={processing === d.id}
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(d.status === 'approved' || d.status === 'suspended') && (
                        <button
                          onClick={() => toggleSuspend(d.id, d.status)}
                          disabled={processing === d.id}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50 ${
                            d.status === 'suspended'
                              ? 'bg-success/10 text-success hover:bg-success/20'
                              : 'bg-danger/10 text-danger hover:bg-danger/20'
                          }`}
                        >
                          {processing === d.id ? '…' : d.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                        </button>
                      )}
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
