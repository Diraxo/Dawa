'use client'

import { useUser, useAuth } from '@clerk/nextjs'
import { useEffect, useRef, useState } from 'react'
import { getAuthClient, supabase } from '@/lib/supabase'
import { pushOwnPhotoToStream } from '@/lib/stream'
import { stripDrPrefix } from '@/lib/utils'
import { MessageCircle, Phone, Video, Camera } from 'lucide-react'

const LANGUAGES = [
  'Arabic', 'Amharic', 'English', 'French', 'Somali', 'Swahili',
  'Tigrinya', 'Oromo', 'Afar', 'Harari', 'Sidama', 'Wolaytta',
  'Turkish', 'Hindi', 'Urdu',
]

interface DoctorProfile {
  specialty: string | null
  years_experience: number | null
  hospital_name: string | null
  license_number: string | null
  bio: string | null
  languages: string[] | null
  chat_price: number | null
  phone_price: number | null
  video_price: number | null
  status: string
  rating_average: number | null
  total_consultations: number | null
  license_doc_url: string | null
  id_doc_url: string | null
}

interface DocEntry { label: string; path: string }

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  rejected: 'bg-danger/10 text-danger',
  suspended: 'bg-steel-grey text-ink-black/60',
}

function parseDocuments(profile: DoctorProfile): DocEntry[] {
  const docs: DocEntry[] = []
  if (profile.license_doc_url) {
    try {
      const paths: string[] = JSON.parse(profile.license_doc_url)
      paths.forEach((_, i) => docs.push({ label: `License Document ${i + 1}`, path: '' }))
    } catch {
      docs.push({ label: 'License Document', path: '' })
    }
  }
  if (profile.id_doc_url) {
    try {
      const parsed = JSON.parse(profile.id_doc_url)
      if (parsed.type === 'national_id') {
        if (parsed.front) docs.push({ label: 'National ID — Front', path: '' })
        if (parsed.back) docs.push({ label: 'National ID — Back', path: '' })
      } else if (parsed.type === 'passport') {
        if (parsed.file ?? parsed.front) docs.push({ label: 'Passport', path: '' })
      } else {
        docs.push({ label: 'ID Document', path: '' })
      }
    } catch {
      docs.push({ label: 'ID Document', path: '' })
    }
  }
  return docs
}

export default function DoctorProfilePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [profile, setProfile] = useState<DoctorProfile | null>(null)
  const [form, setForm] = useState<Partial<DoctorProfile>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [userRowId, setUserRowId] = useState<string | null>(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showPhotoMenu, setShowPhotoMenu] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [specialtiesList, setSpecialtiesList] = useState<string[]>([])

  // Load admin-managed specialties for the dropdown — mirrors mobile's
  // app/(doctor)/my-specialties.tsx and this same platform's registration
  // page (app/doctor/register/page.tsx), both of which already source the
  // list from the canonical `specialties` table instead of free text.
  useEffect(() => {
    supabase
      .from('specialties')
      .select('name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data?.length) setSpecialtiesList(data.map((s: { name: string }) => s.name))
      })
  }, [])

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: ud } = await client.from('users').select('id, profile_photo_url').eq('clerk_id', user!.id).single()
      if (!ud) return
      setUserRowId((ud as any).id)
      setProfilePhotoUrl((ud as any).profile_photo_url || user!.imageUrl || null)
      const { data: dp } = await client.from('doctor_profiles').select('*').eq('user_id', (ud as any).id).single()
      if (dp) {
        setProfile(dp as DoctorProfile)
        setForm(dp)
        setProfileId((dp as any).id)
        setFormLanguages((dp as any).languages ?? [])
      }
    }
    load()
  }, [user])

  // Live-sync own photo — a change made from another device/session (e.g.
  // mobile) should reflect here without a manual reload. Mirrors
  // hooks/useUserPhotoRealtime.ts, scoped inline since this screen already
  // manages photo state (profilePhotoUrl + photoRemoved) by hand.
  useEffect(() => {
    if (!userRowId) return
    const channel = supabase
      .channel(`own-photo-${userRowId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` },
        (payload) => {
          const url = (payload.new as { profile_photo_url: string | null })?.profile_photo_url ?? null
          if (url) setPhotoRemoved(false)
          setProfilePhotoUrl(url)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userRowId])

  const [formLanguages, setFormLanguages] = useState<string[]>([])

  async function handleSave() {
    if (!profileId) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('No auth token')
      const client = getAuthClient(token)
      const { bio, specialty, years_experience, hospital_name, chat_price, phone_price, video_price } = form
      const { data: updatedRows, error } = await client.from('doctor_profiles').update({
        bio, specialty, years_experience, hospital_name, chat_price, phone_price, video_price, languages: formLanguages
      }).eq('id', profileId).select('id')
      if (error) throw error
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('No doctor profile row matched — nothing was saved.')
      }
      setProfile(prev => ({ ...prev!, ...form as DoctorProfile, languages: formLanguages }))
      setEditing(false)
    } catch (e) {
      console.error('Profile save failed:', e)
      alert('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoUpload(file: File) {
    if (!userRowId || !user) return
    setShowPhotoMenu(false)
    setUploadingPhoto(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      // Path must be clerk_id/filename so the RLS foldername policy passes
      // (storage.foldername(name)[1] = clerk_id) — matches mobile convention.
      const path = `${user.id}/avatar.jpg`

      const { error: uploadError } = await client.storage.from('profile-photos').upload(path, file, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = client.storage.from('profile-photos').getPublicUrl(path)
      const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`
      await client.from('users').update({ profile_photo_url: cacheBustedUrl }).eq('id', userRowId)

      setPhotoRemoved(false)
      setProfilePhotoUrl(cacheBustedUrl)
      pushOwnPhotoToStream(cacheBustedUrl)
    } catch (e) {
      console.error('Photo upload failed:', e)
      alert('Photo upload failed. Please try again.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handlePhotoDelete() {
    setShowPhotoMenu(false)
    if (!userRowId || !user) return
    if (!window.confirm('Are you sure you want to delete your profile photo?')) return
    setUploadingPhoto(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: existing } = await client.storage.from('profile-photos').list(user.id)
      if (existing && existing.length > 0) {
        await client.storage.from('profile-photos').remove(existing.map(f => `${user.id}/${f.name}`))
      }
      await client.from('users').update({ profile_photo_url: null }).eq('id', userRowId)

      setPhotoRemoved(true)
      setProfilePhotoUrl(null)
      pushOwnPhotoToStream(null)
    } catch (e) {
      console.error('Photo delete failed:', e)
      alert('Failed to delete photo. Please try again.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const displayName = stripDrPrefix(user?.fullName ?? 'Doctor')
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const docs = profile ? parseDocuments(profile) : []

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">My Profile</h1>
        <p className="text-ink-black/50 text-sm mt-1">Manage your doctor profile and pricing</p>
      </div>

      {/* Pending / rejected banner */}
      {profile && profile.status !== 'approved' && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl mb-6 text-sm font-montserrat border
          ${profile.status === 'rejected' || profile.status === 'suspended'
            ? 'bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]'
            : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'}`}>
          <span className="text-lg shrink-0 mt-0.5">{profile.status === 'rejected' ? '❌' : profile.status === 'suspended' ? '🚫' : '⏳'}</span>
          <div>
            <p className="font-bold mb-0.5">
              {profile.status === 'rejected' ? 'Application Not Approved' : profile.status === 'suspended' ? 'Account Suspended' : 'Account Under Review'}
            </p>
            <p className="opacity-80">
              {profile.status === 'rejected'
                ? 'Your application was not approved. Please contact support@dawa.app to reapply.'
                : profile.status === 'suspended'
                ? 'Your account has been suspended. Please contact support.'
                : 'Your account is under review. You cannot accept consultations until the admin approves you.'}
            </p>
          </div>
        </div>
      )}

      {/* Avatar card */}
      <div className="card p-6 flex items-center gap-5 mb-6">
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowPhotoMenu(v => !v)}
            disabled={uploadingPhoto}
            className="block disabled:opacity-50"
          >
            {profilePhotoUrl && !photoRemoved ? (
              <img src={profilePhotoUrl} alt="Profile" className="w-20 h-20 rounded-3xl object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-3xl bg-gradient-interactive flex items-center justify-center text-white font-black text-2xl">
                {initials}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowPhotoMenu(v => !v)}
            disabled={uploadingPhoto}
            title="Change photo"
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border-2 border-cloud-grey flex items-center justify-center hover:border-int-blue transition-colors disabled:opacity-50"
          >
            {uploadingPhoto ? (
              <div className="w-3 h-3 border-2 border-int-blue border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera size={12} className="text-int-blue" />
            )}
          </button>

          {showPhotoMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPhotoMenu(false)} />
              <div className="absolute left-0 top-24 z-20 w-52 rounded-2xl border border-steel-grey bg-white shadow-lg py-1.5">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full text-left px-4 py-2.5 text-sm font-montserrat text-ink-black hover:bg-cloud-grey"
                >
                  Choose From Gallery
                </button>
                {profilePhotoUrl && !photoRemoved && (
                  <button
                    type="button"
                    onClick={handlePhotoDelete}
                    className="w-full text-left px-4 py-2.5 text-sm font-montserrat text-danger hover:bg-cloud-grey"
                  >
                    Delete Photo
                  </button>
                )}
              </div>
            </>
          )}

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }}
          />
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

      {/* Practice Details */}
      <div className="card p-6 mb-6">
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
          {/* Specialty — controlled dropdown sourced from the admin-managed
              `specialties` table, not free text, so doctors can't drift off
              the canonical list after registration. */}
          <div>
            <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Specialty</label>
            {editing ? (
              <select
                value={(form.specialty as string) ?? ''}
                onChange={e => setForm(prev => ({ ...prev, specialty: e.target.value }))}
                className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
              >
                <option value="">Select specialty</option>
                {specialtiesList.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <p className="h-11 px-4 flex items-center text-sm text-ink-black bg-cloud-grey rounded-2xl">
                {profile?.specialty ?? '—'}
              </p>
            )}
          </div>

          {[
            { key: 'years_experience', label: 'Years of Experience', type: 'number' },
            { key: 'hospital_name', label: 'Hospital / Clinic' },
            { key: 'license_number', label: 'License Number', readonly: true },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">{field.label}</label>
              {editing && !field.readonly ? (
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

        {/* Languages */}
        <div className="mb-6">
          <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Languages Spoken</label>
          {editing ? (
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGES.map(lang => {
                const selected = formLanguages.includes(lang)
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() =>
                      setFormLanguages(prev =>
                        prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
                      )
                    }
                    className={`flex items-center gap-2 h-9 px-3 rounded-xl text-sm font-montserrat text-left transition-colors border ${
                      selected
                        ? 'bg-teal-50 border-teal-green text-teal-green font-semibold'
                        : 'bg-cloud-grey border-steel-grey text-ink-black/60 hover:border-int-blue'
                    }`}
                  >
                    {selected && (
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className="truncate">{lang}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-3 bg-cloud-grey rounded-2xl">
              {profile?.languages && profile.languages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {profile.languages.map(lang => (
                    <span key={lang} className="bg-teal-50 text-teal-green text-xs font-semibold font-montserrat px-3 py-1 rounded-full border border-teal-green/20">
                      {lang}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-black/40">—</p>
              )}
            </div>
          )}
        </div>

        {/* Pricing */}
        <h3 className="font-montserrat font-bold text-base text-ink-black mb-3">Consultation Pricing (ETB)</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'chat_price', label: 'Chat', icon: MessageCircle },
            { key: 'phone_price', label: 'Phone', icon: Phone },
            { key: 'video_price', label: 'Video', icon: Video },
          ].map(p => (
            <div key={p.key}>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
                <p.icon size={12} /> {p.label}
              </label>
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

      {/* Documents (read-only) */}
      <div className="card p-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">My Documents</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-ink-black/40">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-cloud-grey">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A4598" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <span className="text-sm font-medium text-ink-black">{doc.label}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-black/40 mt-4">
          To update your documents, please contact{' '}
          <a href="mailto:support@dawa.app" className="text-teal-green underline">support@dawa.app</a>.
        </p>
      </div>
    </div>
  )
}
