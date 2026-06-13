'use client'

import { useUser, useAuth } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import { getAuthClient } from '@/lib/supabase'
import { getInitials } from '@/lib/utils'

interface DoctorProfile {
  specialty: string
  years_experience: number
  hospital_name: string
  bio: string
  chat_price: number
  phone_price: number
  video_price: number
  status: string
  rating_average: number
  total_consultations: number
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  rejected: 'bg-danger/10 text-danger',
  suspended: 'bg-steel-grey text-ink-black/60',
}

export default function DoctorProfilePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [profile, setProfile] = useState<DoctorProfile | null>(null)
  const [form, setForm] = useState<Partial<DoctorProfile>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!ud) return
      const { data: dp } = await client.from('doctor_profiles').select('*').eq('user_id', ud.id).single()
      if (dp) {
        setProfile(dp as DoctorProfile)
        setForm(dp)
        setProfileId(dp.id)
      }
    }
    load()
  }, [user])

  async function handleSave() {
    if (!profileId) return
    setSaving(true)
    const token = await getToken()
    if (token) {
      const client = getAuthClient(token)
      const { bio, specialty, years_experience, hospital_name, chat_price, phone_price, video_price } = form
      await client.from('doctor_profiles').update({
        bio, specialty, years_experience, hospital_name, chat_price, phone_price, video_price
      }).eq('id', profileId)
      setProfile(prev => ({ ...prev!, ...form as DoctorProfile }))
    }
    setSaving(false)
    setEditing(false)
  }

  const displayName = user?.fullName ?? 'Doctor'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">My Profile</h1>
        <p className="text-ink-black/50 text-sm mt-1">Manage your doctor profile and pricing</p>
      </div>

      {/* Avatar card */}
      <div className="card p-6 flex items-center gap-5 mb-6">
        <div className="w-20 h-20 rounded-3xl bg-gradient-interactive flex items-center justify-center text-white font-black text-2xl flex-shrink-0">
          {getInitials(displayName)}
        </div>
        <div className="flex-1">
          <p className="font-montserrat font-black text-xl text-ink-black">Dr. {displayName}</p>
          <p className="text-ink-black/50 text-sm">{user?.emailAddresses[0]?.emailAddress}</p>
          {profile && (
            <div className="flex items-center gap-3 mt-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS_STYLES[profile.status] ?? ''}`}>
                {profile.status}
              </span>
              <span className="text-yellow-500 text-xs font-bold">★ {profile.rating_average?.toFixed(1) || 'New'}</span>
              <span className="text-ink-black/40 text-xs">{profile.total_consultations} consultations</span>
            </div>
          )}
        </div>
      </div>

      {/* Profile fields */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-montserrat font-bold text-lg text-ink-black">Practice Details</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-outline h-9 px-4 text-sm rounded-xl">Edit</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="btn-outline h-9 px-4 text-sm rounded-xl">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary h-9 px-4 text-sm rounded-xl disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {[
            { key: 'specialty', label: 'Specialty' },
            { key: 'years_experience', label: 'Years of Experience', type: 'number' },
            { key: 'hospital_name', label: 'Hospital / Clinic' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">{field.label}</label>
              {editing ? (
                <input
                  type={field.type ?? 'text'}
                  value={(form[field.key as keyof DoctorProfile] as string | number) ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value }))}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                />
              ) : (
                <p className="h-11 px-4 flex items-center text-sm text-ink-black bg-cloud-grey rounded-2xl">
                  {profile?.[field.key as keyof DoctorProfile] ?? '—'}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Bio */}
        <div className="mb-6">
          <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Bio</label>
          {editing ? (
            <textarea
              value={form.bio ?? ''}
              onChange={e => setForm(prev => ({ ...prev, bio: e.target.value }))}
              rows={3}
              className="w-full px-4 py-3 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue resize-none"
            />
          ) : (
            <p className="px-4 py-3 text-sm text-ink-black bg-cloud-grey rounded-2xl min-h-[60px]">
              {profile?.bio || '—'}
            </p>
          )}
        </div>

        {/* Pricing */}
        <h3 className="font-montserrat font-bold text-base text-ink-black mb-3">Consultation Pricing (ETB)</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'chat_price', label: '💬 Chat' },
            { key: 'phone_price', label: '📞 Phone' },
            { key: 'video_price', label: '🎥 Video' },
          ].map(p => (
            <div key={p.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">{p.label}</label>
              {editing ? (
                <input
                  type="number"
                  value={(form[p.key as keyof DoctorProfile] as number) ?? 0}
                  onChange={e => setForm(prev => ({ ...prev, [p.key]: Number(e.target.value) }))}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                />
              ) : (
                <p className="h-11 px-4 flex items-center text-sm font-bold text-teal-green bg-cloud-grey rounded-2xl">
                  {profile?.[p.key as keyof DoctorProfile] ? `ETB ${profile[p.key as keyof DoctorProfile]}` : '—'}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
