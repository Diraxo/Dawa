'use client'

import { useUser, useAuth, useClerk } from '@clerk/nextjs'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthClient, supabase } from '@/lib/supabase'
import { pushOwnPhotoToStream } from '@/lib/stream'
import { getInitials } from '@/lib/utils'
import { COUNTRIES } from '@/lib/countries'

interface UserProfile {
  full_name: string
  email: string
  phone: string
  country: string
  language: string
  address: string
  profile_photo_url: string | null
}

interface HealthProfile {
  date_of_birth: string
  gender: string
}

type DangerDialog = 'none' | 'deactivate' | 'delete' | 'delete-confirm'

export default function PatientProfilePage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const { signOut } = useClerk()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [dangerDialog, setDangerDialog] = useState<DangerDialog>('none')
  const [dangerLoading, setDangerLoading] = useState(false)
  const [dangerError, setDangerError] = useState<string | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null)
  const [healthProfileId, setHealthProfileId] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<UserProfile>({ full_name: '', email: '', phone: '', country: '', language: '', address: '', profile_photo_url: null })
  const [healthForm, setHealthForm] = useState<HealthProfile>({ date_of_birth: '', gender: '' })

  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  // Once the patient explicitly removes their photo, force the default avatar
  // for the rest of this session instead of silently falling back to Clerk's
  // (e.g. Google) photo via the usual profile_photo_url-or-imageUrl pattern.
  const [photoRemoved, setPhotoRemoved] = useState(false)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { data: ud } = await client
        .from('users')
        .select('id, full_name, email, phone, country, language, address, profile_photo_url')
        .eq('clerk_id', user!.id)
        .single()

      if (ud) {
        const p: UserProfile = {
          full_name: (ud as any).full_name ?? '',
          email: (ud as any).email ?? '',
          phone: (ud as any).phone ?? '',
          country: (ud as any).country ?? '',
          language: (ud as any).language ?? '',
          address: (ud as any).address ?? '',
          profile_photo_url: (ud as any).profile_photo_url ?? null,
        }
        setProfile(p)
        setForm(p)
        setUserId((ud as any).id)

        const { data: pp } = await client
          .from('patient_profiles')
          .select('id, date_of_birth, gender')
          .eq('user_id', (ud as any).id)
          .maybeSingle()

        if (pp) {
          const hp: HealthProfile = {
            date_of_birth: (pp as any).date_of_birth ?? '',
            gender: (pp as any).gender ?? '',
          }
          setHealthProfile(hp)
          setHealthForm(hp)
          setHealthProfileId((pp as any).id)
        }
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Live-sync own photo — a change made from another device/session (e.g.
  // mobile) should reflect here without a manual reload. Mirrors
  // hooks/useUserPhotoRealtime.ts, scoped inline since this screen already
  // manages photo state (profile.profile_photo_url + photoRemoved) by hand.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`own-photo-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
        (payload) => {
          const url = (payload.new as { profile_photo_url: string | null })?.profile_photo_url ?? null
          if (url) setPhotoRemoved(false)
          setProfile(prev => prev ? { ...prev, profile_photo_url: url } : prev)
          setForm(prev => ({ ...prev, profile_photo_url: url }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  async function handlePhotoUpload(file: File) {
    if (!userId || !user) return
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
      await client.from('users').update({ profile_photo_url: publicUrl }).eq('id', userId)

      setPhotoRemoved(false)
      setProfile(prev => prev ? { ...prev, profile_photo_url: publicUrl } : prev)
      setForm(prev => ({ ...prev, profile_photo_url: publicUrl }))
      pushOwnPhotoToStream(publicUrl)
    } catch (e) {
      console.error('Photo upload failed:', e)
      alert('Photo upload failed. Please try again.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handlePhotoDelete() {
    if (!userId || !user) return
    setUploadingPhoto(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const path = `${user.id}/avatar.jpg`

      // Best-effort — a missing/already-deleted file must not block clearing the DB field.
      await client.storage.from('profile-photos').remove([path]).catch(() => {})
      await client.from('users').update({ profile_photo_url: null }).eq('id', userId)

      // Deliberately falls back to the default initials avatar, not Clerk's photo.
      setPhotoRemoved(true)
      setProfile(prev => prev ? { ...prev, profile_photo_url: null } : prev)
      setForm(prev => ({ ...prev, profile_photo_url: null }))
      pushOwnPhotoToStream(null)
    } catch (e) {
      console.error('Photo delete failed:', e)
      alert('Failed to remove photo. Please try again.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handleSave() {
    if (!userId) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { full_name, phone, country, language, address } = form
      await client.from('users').update({ full_name, phone, country, language, address: address.trim() || null }).eq('id', userId)

      const healthData = {
        date_of_birth: healthForm.date_of_birth || null,
        gender: healthForm.gender || null,
      }
      if (healthProfileId) {
        await client.from('patient_profiles').update(healthData).eq('id', healthProfileId)
      } else {
        const { data: newPp } = await client
          .from('patient_profiles')
          .insert({ user_id: userId, ...healthData })
          .select('id')
          .single()
        if (newPp) setHealthProfileId((newPp as any).id)
      }

      setProfile(prev => prev ? { ...prev, ...form } : prev)
      setHealthProfile({ ...healthForm })
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    if (profile) setForm(profile)
    if (healthProfile) setHealthForm(healthProfile)
  }

  async function handleDeactivate() {
    if (!userId || !user) return
    setDangerLoading(true)
    setDangerError(null)
    try {
      await signOut({ redirectUrl: '/sign-in' })
    } catch {
      setDangerError('Failed to deactivate. Please try again.')
    } finally {
      setDangerLoading(false)
    }
  }

  async function handleDeleteFinal() {
    if (!userId || !user) return
    setDangerLoading(true)
    setDangerError(null)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      // Best-effort — a missing file must never block account deletion.
      await client.storage.from('profile-photos').remove([`${user.id}/avatar.jpg`]).catch(() => {})
      await client.from('users').delete().eq('id', userId)
      await user.delete()
      router.replace('/sign-up')
    } catch {
      setDangerError('Unable to delete account. Please contact support at support@dawa.app')
      setDangerLoading(false)
      setDangerDialog('none')
    }
  }

  const displayName = profile?.full_name || user?.fullName || 'Patient'
  const photoUrl = photoRemoved ? null : (profile?.profile_photo_url || user?.imageUrl || null)

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Profile</h1>
        <p className="text-ink-black/50 text-sm mt-1">Manage your personal information</p>
      </div>

      {/* Avatar + name */}
      <div className="card p-6 flex items-center gap-5 mb-6">
        <div className="relative flex-shrink-0">
          {photoUrl ? (
            <img src={photoUrl} alt="Profile" className="w-20 h-20 rounded-3xl object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-3xl bg-gradient-hero flex items-center justify-center text-white font-black text-2xl">
              {getInitials(displayName)}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            title="Change photo"
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border-2 border-cloud-grey flex items-center justify-center hover:border-int-blue transition-colors disabled:opacity-50"
          >
            {uploadingPhoto ? (
              <div className="w-3 h-3 border-2 border-int-blue border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2962FF" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f) }}
          />
        </div>
        <div>
          <p className="font-montserrat font-black text-xl text-ink-black">{displayName}</p>
          <p className="text-ink-black/50 text-sm">{user?.emailAddresses[0]?.emailAddress}</p>
          <span className="inline-block mt-2 px-3 py-1 rounded-full bg-teal-green/10 text-teal-green text-xs font-bold">
            Patient
          </span>
          {photoUrl && (
            <button
              onClick={handlePhotoDelete}
              disabled={uploadingPhoto}
              className="block mt-2 text-danger text-xs font-semibold hover:underline disabled:opacity-50"
            >
              Delete Photo
            </button>
          )}
        </div>
      </div>

      {/* Personal Information */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-montserrat font-bold text-lg text-ink-black">Personal Information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-outline h-9 px-4 text-sm rounded-xl">Edit</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={handleCancel} className="btn-outline h-9 px-4 text-sm rounded-xl">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary h-9 px-4 text-sm rounded-xl disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'full_name', label: 'Full Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email', readonly: true },
            { key: 'phone', label: 'Phone Number', type: 'tel' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
                {field.label}
              </label>
              {editing && !field.readonly ? (
                <input
                  type={field.type}
                  value={form[field.key as keyof UserProfile] as string ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
                />
              ) : (
                <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl">
                  {profile?.[field.key as keyof UserProfile] || '—'}
                </p>
              )}
            </div>
          ))}

          {/* Country — a one-time choice. Once set (matching mobile's
              lock-icon convention at app/(auth)/country.tsx +
              edit-personal-info.tsx) it can never be changed again, so admin
              always sees a stable value. */}
          <div>
            <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
              Country
            </label>
            {editing && !form.country ? (
              <select
                value={form.country}
                onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
              >
                <option value="">Select country</option>
                {COUNTRIES.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            ) : (
              <>
                <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl">
                  {profile?.country || '—'}
                </p>
                {editing && (
                  <p className="text-[11px] text-ink-black/40 mt-1">
                    Country cannot be changed once set. Contact support@dawa.app for help.
                  </p>
                )}
              </>
            )}
          </div>

          {[
            { key: 'language', label: 'Language', type: 'text' },
            { key: 'address', label: 'Address', type: 'text' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
                {field.label}
              </label>
              {editing ? (
                <input
                  type={field.type}
                  value={form[field.key as keyof UserProfile] as string ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
                />
              ) : (
                <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl">
                  {profile?.[field.key as keyof UserProfile] || '—'}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Health Profile */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-5">Health Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
              Date of Birth
            </label>
            {editing ? (
              <input
                type="date"
                value={healthForm.date_of_birth}
                onChange={e => setHealthForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
              />
            ) : (
              <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl">
                {healthProfile?.date_of_birth || '—'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">
              Gender
            </label>
            {editing ? (
              <select
                value={healthForm.gender}
                onChange={e => setHealthForm(prev => ({ ...prev, gender: e.target.value }))}
                className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            ) : (
              <p className="h-11 px-4 flex items-center font-montserrat text-sm text-ink-black bg-cloud-grey rounded-2xl capitalize">
                {healthProfile?.gender?.replace(/_/g, ' ') || '—'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card p-6 mt-6 border border-danger/20">
        <h2 className="font-montserrat font-bold text-base text-danger mb-4">Danger Zone</h2>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setDangerDialog('deactivate')}
            className="w-full h-11 rounded-2xl border-2 border-warning text-warning font-montserrat font-semibold text-sm flex items-center justify-center gap-2 hover:bg-warning/5 transition-colors"
          >
            ⏸ Deactivate Account
          </button>
          <button
            onClick={() => setDangerDialog('delete')}
            className="w-full h-11 rounded-2xl border-2 border-danger text-danger font-montserrat font-semibold text-sm flex items-center justify-center gap-2 hover:bg-danger/5 transition-colors"
          >
            🗑 Delete Account
          </button>
        </div>
        {dangerError && (
          <p className="text-danger text-xs mt-3 text-center">{dangerError}</p>
        )}
      </div>

      {/* Confirmation Dialogs */}
      {dangerDialog !== 'none' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-xl">
            {dangerDialog === 'deactivate' && (
              <>
                <p className="text-3xl mb-4 text-center">⏸</p>
                <h3 className="font-montserrat font-black text-xl text-ink-black mb-2 text-center">Deactivate Account</h3>
                <p className="text-ink-black/60 text-sm text-center mb-6">
                  Your account will be deactivated and you will be logged out. You can reactivate by contacting support.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setDangerDialog('none')} className="flex-1 btn-outline h-11 rounded-2xl text-sm">Cancel</button>
                  <button
                    onClick={handleDeactivate}
                    disabled={dangerLoading}
                    className="flex-1 h-11 rounded-2xl bg-warning text-white font-semibold text-sm disabled:opacity-50"
                  >
                    {dangerLoading ? '…' : 'Deactivate'}
                  </button>
                </div>
              </>
            )}
            {dangerDialog === 'delete' && (
              <>
                <p className="text-3xl mb-4 text-center">🗑</p>
                <h3 className="font-montserrat font-black text-xl text-ink-black mb-2 text-center">Delete Account</h3>
                <p className="text-ink-black/60 text-sm text-center mb-6">
                  This will permanently delete your account and all your data. This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setDangerDialog('none')} className="flex-1 btn-outline h-11 rounded-2xl text-sm">Cancel</button>
                  <button
                    onClick={() => setDangerDialog('delete-confirm')}
                    className="flex-1 h-11 rounded-2xl bg-danger text-white font-semibold text-sm"
                  >
                    Continue
                  </button>
                </div>
              </>
            )}
            {dangerDialog === 'delete-confirm' && (
              <>
                <p className="text-3xl mb-4 text-center">⚠️</p>
                <h3 className="font-montserrat font-black text-xl text-ink-black mb-2 text-center">Final Confirmation</h3>
                <p className="text-ink-black/60 text-sm text-center mb-6">
                  All your consultations, medical records, and account data will be permanently removed. Are you absolutely sure?
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setDangerDialog('none')} className="flex-1 btn-outline h-11 rounded-2xl text-sm">Cancel</button>
                  <button
                    onClick={handleDeleteFinal}
                    disabled={dangerLoading}
                    className="flex-1 h-11 rounded-2xl bg-danger text-white font-semibold text-sm disabled:opacity-50"
                  >
                    {dangerLoading ? '…' : 'Delete Forever'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
