'use client'

import { useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getAuthClient } from '@/lib/supabase'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

const SPECIALTIES = ['General Practice', 'Cardiology', 'Pediatrics', 'Dermatology', 'Neurology', 'Orthopedics', 'Psychiatry', 'Gynecology', 'Internal Medicine', 'ENT', 'Ophthalmology', 'Dentistry', 'Other']
const STEPS = ['Personal Info', 'Specialty & Experience', 'Documents', 'Pricing', 'Submit']

interface FormData {
  licenseNumber: string
  specialty: string
  yearsExperience: string
  hospitalName: string
  bio: string
  chatPrice: string
  phonePrice: string
  videoPrice: string
}

export default function DoctorRegisterPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [licenseFile, setLicenseFile] = useState<globalThis.File | null>(null)
  const [idFile, setIdFile] = useState<globalThis.File | null>(null)
  const [form, setForm] = useState<FormData>({
    licenseNumber: '', specialty: '', yearsExperience: '', hospitalName: '', bio: '',
    chatPrice: '', phonePrice: '', videoPrice: '',
  })

  function set(key: keyof FormData, val: string) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function uploadDoc(client: ReturnType<typeof getAuthClient>, file: globalThis.File, label: string) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const path = `${user!.id}/${label}-${Date.now()}.${ext}`
    const { error: upErr } = await client.storage
      .from('doctor-documents')
      .upload(path, file, { upsert: true })
    if (upErr) throw new Error(`Failed to upload ${label}: ${upErr.message}`)
    return path
  }

  async function handleSubmit() {
    if (!user) return
    setSubmitting(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const client = getAuthClient(token)
      const { data: ud } = await client
        .from('users')
        .upsert(
          {
            clerk_id: user.id,
            email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '',
            full_name: user.fullName ?? '',
            role: 'doctor',
          },
          { onConflict: 'clerk_id' }
        )
        .select('id')
        .single()
      if (!ud) throw new Error('User not found')

      const licensePath = licenseFile ? await uploadDoc(client, licenseFile, 'license') : null
      const idPath = idFile ? await uploadDoc(client, idFile, 'national-id') : null

      const { error: insertErr } = await client.from('doctor_profiles').upsert({
        user_id: ud.id,
        license_number: form.licenseNumber,
        specialty: form.specialty,
        years_experience: parseInt(form.yearsExperience) || 0,
        hospital_name: form.hospitalName,
        bio: form.bio,
        license_doc_url: licensePath,
        id_doc_url: idPath,
        chat_price: parseFloat(form.chatPrice) || 0,
        phone_price: parseFloat(form.phonePrice) || 0,
        video_price: parseFloat(form.videoPrice) || 0,
        status: 'pending',
      }, { onConflict: 'user_id' })
      if (insertErr) throw new Error(insertErr.message)

      router.push('/doctor/under-review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = "w-full h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue transition-colors"

  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <LogoMark size={40} />
          <span className="font-montserrat font-bold text-2xl text-ink-black">
            CARE<span className="text-teal-green">HUB</span>
          </span>
        </Link>

        {/* Progress */}
        <div className="flex gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all ${i <= step ? 'bg-gradient-interactive' : 'bg-steel-grey'}`} />
              <p className={`text-[10px] mt-1 font-medium text-center ${i === step ? 'text-int-blue' : 'text-ink-black/40'}`}>{s}</p>
            </div>
          ))}
        </div>

        <div className="card p-8">
          <h1 className="font-montserrat font-black text-2xl text-ink-black mb-6">
            {STEPS[step]}
          </h1>

          {/* Step 0: Personal */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Medical License Number *</label>
                <input className={inputClass} placeholder="e.g. ET-MED-2024-12345" value={form.licenseNumber} onChange={e => set('licenseNumber', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Hospital / Clinic Name *</label>
                <input className={inputClass} placeholder="Where you currently practice" value={form.hospitalName} onChange={e => set('hospitalName', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Professional Bio</label>
                <textarea
                  className="w-full px-4 py-3 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue resize-none"
                  rows={3}
                  placeholder="Brief introduction about your practice and approach…"
                  value={form.bio}
                  onChange={e => set('bio', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 1: Specialty */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-2">Specialty *</label>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTIES.map(sp => (
                    <button key={sp} onClick={() => set('specialty', sp)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        form.specialty === sp ? 'bg-gradient-interactive text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey hover:border-int-blue'
                      }`}>
                      {sp}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Years of Experience *</label>
                <input className={inputClass} type="number" min="0" max="60" placeholder="e.g. 5" value={form.yearsExperience} onChange={e => set('yearsExperience', e.target.value)} />
              </div>
            </div>
          )}

          {/* Step 2: Documents */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <p className="text-ink-black/60 text-sm">
                Upload your medical license and a national ID. The admin team reviews these before approval.
              </p>
              {[
                { label: '📄 Medical License *', file: licenseFile, set: setLicenseFile },
                { label: '🪪 National ID *', file: idFile, set: setIdFile },
              ].map(doc => (
                <div key={doc.label}>
                  <label className="block text-xs font-bold text-ink-black/50 mb-1.5">{doc.label}</label>
                  <label className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl border border-dashed border-steel-grey bg-cloud-grey cursor-pointer hover:border-int-blue transition-colors">
                    <span className="text-lg">{doc.file ? '✅' : '📎'}</span>
                    <span className="text-sm text-ink-black/60 truncate flex-1">
                      {doc.file ? doc.file.name : 'Choose PDF or image…'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={e => doc.set(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Pricing */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-ink-black/60 text-sm">Set your consultation fees in Ethiopian Birr (ETB).</p>
              {[
                { key: 'chatPrice' as const, label: '💬 Chat Consultation' },
                { key: 'phonePrice' as const, label: '📞 Phone Consultation' },
                { key: 'videoPrice' as const, label: '🎥 Video Consultation' },
              ].map(p => (
                <div key={p.key}>
                  <label className="block text-xs font-bold text-ink-black/50 mb-1.5">{p.label} (ETB)</label>
                  <input className={inputClass} type="number" min="0" placeholder="0" value={form[p.key]} onChange={e => set(p.key, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="flex flex-col gap-3">
              <div className="bg-cloud-grey rounded-2xl p-4 flex flex-col gap-2">
                {[
                  { label: 'License', value: form.licenseNumber },
                  { label: 'Specialty', value: form.specialty },
                  { label: 'Experience', value: `${form.yearsExperience} years` },
                  { label: 'Hospital', value: form.hospitalName },
                  { label: 'License Doc', value: licenseFile?.name ?? '' },
                  { label: 'National ID', value: idFile?.name ?? '' },
                  { label: 'Chat Price', value: `ETB ${form.chatPrice}` },
                  { label: 'Phone Price', value: `ETB ${form.phonePrice}` },
                  { label: 'Video Price', value: `ETB ${form.videoPrice}` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-ink-black/50">{r.label}</span>
                    <span className="font-semibold text-ink-black">{r.value || '—'}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-2.5 bg-blue-50 rounded-2xl p-3.5">
                <span className="text-int-blue text-base">ℹ️</span>
                <p className="text-xs text-int-blue/80">
                  Your application will be reviewed by an admin within 24–48 hours. You&apos;ll receive an email notification once approved.
                </p>
              </div>
              {error && <p className="text-danger text-xs text-center">{error}</p>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className="btn-outline flex-1 h-12 rounded-2xl">
                ← Back
              </button>
            )}
            {step < 4 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={step === 2 && (!licenseFile || !idFile)}
                className="btn-primary flex-1 h-12 rounded-2xl disabled:opacity-50"
              >
                Next →
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 h-12 rounded-2xl disabled:opacity-50">
                {submitting ? 'Submitting…' : '🚀 Submit Application'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
