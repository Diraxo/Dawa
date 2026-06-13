'use client'

import { useUser, useAuth } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import { getAuthClient } from '@/lib/supabase'
import { getInitials } from '@/lib/utils'

interface Profile {
  full_name: string
  email: string
  phone: string
  country: string
  language: string
}

export default function PatientProfilePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Profile>({ full_name: '', email: '', phone: '', country: '', language: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data } = await client.from('users').select('full_name, email, phone, country, language').eq('clerk_id', user!.id).single()
      if (data) {
        setProfile(data)
        setForm(data)
      }
    }
    load()
  }, [user])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const token = await getToken()
    if (token) {
      const client = getAuthClient(token)
      await client.from('users').update(form).eq('clerk_id', user.id)
      setProfile(form)
    }
    setSaving(false)
    setEditing(false)
  }

  const displayName = profile?.full_name || user?.fullName || 'Patient'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Profile</h1>
        <p className="text-ink-black/50 text-sm mt-1">Manage your personal information</p>
      </div>

      {/* Avatar + name */}
      <div className="card p-6 flex items-center gap-5 mb-6">
        <div className="w-20 h-20 rounded-3xl bg-gradient-hero flex items-center justify-center text-white font-black text-2xl flex-shrink-0">
          {getInitials(displayName)}
        </div>
        <div>
          <p className="font-montserrat font-black text-xl text-ink-black">{displayName}</p>
          <p className="text-ink-black/50 text-sm">{user?.emailAddresses[0]?.emailAddress}</p>
          <span className="inline-block mt-2 px-3 py-1 rounded-full bg-teal-green/10 text-teal-green text-xs font-bold">
            Patient
          </span>
        </div>
      </div>

      {/* Details form */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-montserrat font-bold text-lg text-ink-black">Personal Information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-outline h-9 px-4 text-sm rounded-xl">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setForm(profile ?? form) }} className="btn-outline h-9 px-4 text-sm rounded-xl">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary h-9 px-4 text-sm rounded-xl disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'full_name', label: 'Full Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone Number', type: 'tel' },
            { key: 'country', label: 'Country', type: 'text' },
            { key: 'language', label: 'Language', type: 'text' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
                {field.label}
              </label>
              {editing ? (
                <input
                  type={field.type}
                  value={form[field.key as keyof Profile]}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
                />
              ) : (
                <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl">
                  {profile?.[field.key as keyof Profile] || '—'}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
