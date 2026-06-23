'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Specialty {
  id: string
  name: string
  created_at: string
}

export default function SpecialtiesPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/specialties')
    if (res.ok) setSpecialties(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()

    // Realtime keeps the list in sync across tabs / devices
    const channel = supabase
      .channel('admin-specialties-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'specialties' }, load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    setError('')
    const res = await fetch('/api/admin/specialties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to add specialty.')
    } else {
      const added: Specialty = await res.json()
      setSpecialties(prev =>
        [...prev, added].sort((a, b) => a.name.localeCompare(b.name))
      )
      setNewName('')
    }
    setAdding(false)
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setConfirmId(null)
    const res = await fetch(`/api/admin/specialties/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to delete specialty.')
      setDeletingId(null)
    } else {
      setSpecialties(prev => prev.filter(s => s.id !== id))
      setDeletingId(null)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Specialties</h1>
        <p className="text-ink-black/50 text-sm mt-1">
          Manage the specialty list shown to doctors during registration and to patients when browsing.
        </p>
      </div>

      {/* Add form */}
      <div className="card p-5 mb-6">
        <p className="font-montserrat font-bold text-base text-ink-black mb-3">Add Specialty</p>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="e.g. Cardiology"
            value={newName}
            onChange={e => { setNewName(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="btn-primary h-11 px-6 text-sm rounded-xl disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
        {error && <p className="text-danger text-xs mt-2 font-semibold">{error}</p>}
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-steel-grey flex items-center justify-between">
          <p className="font-montserrat font-bold text-base text-ink-black">
            {specialties.length} {specialties.length === 1 ? 'Specialty' : 'Specialties'}
          </p>
          <p className="text-ink-black/40 text-xs">Changes reflect everywhere instantly</p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-ink-black/40 text-sm">Loading…</div>
        ) : specialties.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-2xl mb-2">🩺</p>
            <p className="font-montserrat font-bold text-base text-ink-black mb-1">No specialties yet</p>
            <p className="text-ink-black/50 text-sm">Add your first specialty above.</p>
          </div>
        ) : (
          <ul className="divide-y divide-steel-grey/50">
            {specialties.map(s => (
              <li key={s.id} className="px-5 py-3.5">
                {confirmId === s.id ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                      <p className="font-montserrat text-sm text-ink-black truncate">
                        Delete <span className="font-semibold">"{s.name}"</span>?
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setConfirmId(null)}
                        className="h-8 px-4 rounded-xl border border-steel-grey text-xs font-semibold text-ink-black/70 hover:bg-cloud-grey transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="h-8 px-4 rounded-xl bg-danger text-white text-xs font-bold hover:bg-danger/90 transition-colors disabled:opacity-50"
                      >
                        {deletingId === s.id ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="font-montserrat font-semibold text-sm text-ink-black">{s.name}</span>
                    <button
                      onClick={() => setConfirmId(s.id)}
                      disabled={deletingId === s.id}
                      className="text-ink-black/30 hover:text-danger text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
