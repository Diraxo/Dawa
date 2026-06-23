'use client'

import { useState, useEffect, useRef } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getAuthClient, supabase } from '@/lib/supabase'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'
import { MIN_AGE_DOCTOR, meetsAgeRequirement } from '@/lib/ageValidation'

const STEP_LABELS = ['Personal Info', 'Credentials', 'Documents', 'Pricing']
const MAX_BIO = 300

function fileIcon(file: File) {
  return file.type.startsWith('image/') ? '🖼️' : '📄'
}

export default function DoctorRegisterPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [specialtiesList, setSpecialtiesList] = useState<string[]>([])
  const [showSpecialtyDropdown, setShowSpecialtyDropdown] = useState(false)
  const specialtyRef = useRef<HTMLDivElement>(null)

  // ── Step 1: Personal Info ────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<'Male' | 'Female' | ''>('')
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null)
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null)
  const [dobError, setDobError] = useState('')

  // ── Step 2: Credentials ──────────────────────────────────────────────────────
  const [licenseNumber, setLicenseNumber] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [yearsExperience, setYearsExperience] = useState(0)
  const [hospitalName, setHospitalName] = useState('')
  const [bio, setBio] = useState('')

  // ── Step 3: Documents ────────────────────────────────────────────────────────
  const [licenseFiles, setLicenseFiles] = useState<File[]>([])
  const [idDocType, setIdDocType] = useState<'national_id' | 'passport' | null>(null)
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null)
  const [idBackFile, setIdBackFile] = useState<File | null>(null)

  // ── Step 4: Pricing ──────────────────────────────────────────────────────────
  const [chatPrice, setChatPrice] = useState('')
  const [phonePrice, setPhonePrice] = useState('')
  const [videoPrice, setVideoPrice] = useState('')

  // Pre-fill name from Clerk
  useEffect(() => {
    if (user?.fullName && !fullName) setFullName(user.fullName)
  }, [user?.fullName])

  // Load specialties
  useEffect(() => {
    supabase
      .from('specialties')
      .select('name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data?.length) setSpecialtiesList(data.map((s: { name: string }) => s.name))
      })
  }, [])

  // Close specialty dropdown on outside click
  useEffect(() => {
    if (!showSpecialtyDropdown) return
    function handleClick(e: MouseEvent) {
      if (specialtyRef.current && !specialtyRef.current.contains(e.target as Node)) {
        setShowSpecialtyDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSpecialtyDropdown])

  // ── Validation ───────────────────────────────────────────────────────────────
  const step1Valid = fullName.trim().length > 1 && phone.trim().length > 5 && dateOfBirth !== '' && gender !== ''
  const step2Valid = licenseNumber.trim().length > 3 && specialty.length > 0 && hospitalName.trim().length > 1
  const idComplete =
    idDocType === null ||
    (idDocType === 'national_id' && !!idFrontFile && !!idBackFile) ||
    (idDocType === 'passport' && !!idFrontFile)
  const step3Valid = licenseFiles.length > 0 && idComplete
  const step4Valid = chatPrice.length > 0 && phonePrice.length > 0 && videoPrice.length > 0
  const stepValid = [step1Valid, step2Valid, step3Valid, step4Valid]

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleNext() {
    if (step === 0 && dateOfBirth && !meetsAgeRequirement(new Date(dateOfBirth), 'doctor')) {
      setDobError(`You must be at least ${MIN_AGE_DOCTOR} years old to register as a doctor.`)
      return
    }
    setDobError('')
    setStep(s => s + 1)
  }

  function handlePhotoSelect() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      setProfilePhotoFile(file)
      const reader = new FileReader()
      reader.onload = (ev) => setProfilePhotoPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
    }
    input.click()
  }

  function switchIdType(type: 'national_id' | 'passport') {
    setIdDocType(type)
    setIdFrontFile(null)
    setIdBackFile(null)
  }

  async function uploadDoc(client: ReturnType<typeof getAuthClient>, file: File, label: string) {
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

      // Upsert user with all personal info
      const { data: ud } = await client
        .from('users')
        .upsert(
          {
            clerk_id: user.id,
            email: user.primaryEmailAddress?.emailAddress ?? '',
            full_name: fullName,
            phone: phone || null,
            role: 'doctor',
          },
          { onConflict: 'clerk_id' }
        )
        .select('id')
        .single()
      if (!ud) throw new Error('Could not save your account. Please try again.')

      // Upload profile photo (non-blocking if it fails)
      if (profilePhotoFile) {
        try {
          const ext = profilePhotoFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
          const photoPath = `${user.id}.${ext}`
          await client.storage.from('avatars').upload(photoPath, profilePhotoFile, { upsert: true })
          const { data: urlData } = client.storage.from('avatars').getPublicUrl(photoPath)
          await client.from('users').update({ profile_photo_url: urlData.publicUrl }).eq('clerk_id', user.id)
        } catch {
          // Profile photo failure is non-blocking
        }
      }

      // Upload license documents
      const licensePaths = await Promise.all(
        licenseFiles.map((f, i) => uploadDoc(client, f, `license-${i}`))
      )
      const licenseDocUrl = licensePaths.length > 0 ? JSON.stringify(licensePaths) : null

      // Upload ID document
      let idDocUrl: string | null = null
      if (idDocType === 'national_id') {
        const front = idFrontFile ? await uploadDoc(client, idFrontFile, 'national-id-front') : null
        const back = idBackFile ? await uploadDoc(client, idBackFile, 'national-id-back') : null
        if (front || back) idDocUrl = JSON.stringify({ type: 'national_id', front, back })
      } else if (idDocType === 'passport' && idFrontFile) {
        const passportPath = await uploadDoc(client, idFrontFile, 'passport')
        idDocUrl = JSON.stringify({ type: 'passport', file: passportPath })
      }

      const { error: insertErr } = await client.from('doctor_profiles').upsert(
        {
          user_id: ud.id,
          license_number: licenseNumber,
          specialty,
          years_experience: yearsExperience,
          hospital_name: hospitalName,
          bio,
          license_doc_url: licenseDocUrl,
          id_doc_url: idDocUrl,
          chat_price: parseInt(chatPrice) || 0,
          phone_price: parseInt(phonePrice) || 0,
          video_price: parseInt(videoPrice) || 0,
          status: 'pending',
          date_of_birth: dateOfBirth || null,
          gender: gender || null,
        },
        { onConflict: 'user_id' }
      )
      if (insertErr) throw new Error(insertErr.message)

      router.push('/doctor/under-review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const progress = ((step + 1) / 4) * 100
  const inputClass =
    'w-full h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue transition-colors'

  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <LogoMark size={40} variant="dark" />
          <span className="font-montserrat font-bold text-2xl text-ink-black">
            DA<span className="text-teal-green">WA</span>
          </span>
        </Link>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between mb-1.5">
            {STEP_LABELS.map((label, i) => (
              <span
                key={label}
                className={`text-[10px] font-semibold transition-colors ${
                  i === step ? 'text-int-blue' : i < step ? 'text-teal-green' : 'text-ink-black/30'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="h-1.5 bg-steel-grey rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-interactive rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-ink-black/40 mt-1 text-right font-montserrat">
            Step {step + 1} of 4
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-8">
          <h1 className="font-montserrat font-black text-2xl text-ink-black mb-6">
            {['Create Your Profile', 'Your Credentials', 'Verify Your Identity', 'Set Consultation Prices'][step]}
          </h1>

          {/* ══════════════════════════════════════════════════════════════════
              STEP 1 — Personal Info
          ══════════════════════════════════════════════════════════════════ */}
          {step === 0 && (
            <div className="flex flex-col gap-4">

              {/* Profile photo */}
              <div className="flex flex-col items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={handlePhotoSelect}
                  className="w-28 h-28 rounded-full bg-cloud-grey border-2 border-dashed border-steel-grey flex items-center justify-center overflow-hidden hover:border-int-blue transition-colors focus:outline-none"
                >
                  {profilePhotoPreview ? (
                    <img src={profilePhotoPreview} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
                      <svg className="w-7 h-7 text-care-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  )}
                </button>
                <span className="text-xs font-semibold text-teal-green font-montserrat">
                  {profilePhotoPreview ? 'Click to change photo' : 'Click to add photo'}
                </span>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Full Name *</label>
                <input
                  className={inputClass}
                  placeholder="Dr. Jane Smith"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Phone Number *</label>
                <div className="flex gap-2">
                  <div className="h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey flex items-center font-montserrat text-sm font-semibold text-ink-black whitespace-nowrap select-none">
                    +251
                  </div>
                  <input
                    className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue transition-colors"
                    placeholder="912 345 678"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              </div>

              {/* Date of Birth */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Date of Birth *</label>
                <input
                  className={inputClass}
                  type="date"
                  value={dateOfBirth}
                  onChange={e => { setDateOfBirth(e.target.value); setDobError('') }}
                  max={new Date().toISOString().split('T')[0]}
                />
                {dobError && <p className="text-xs text-danger mt-1 font-montserrat">{dobError}</p>}
              </div>

              {/* Gender */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-2">Gender *</label>
                <div className="flex gap-3">
                  {(['Male', 'Female'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className={`flex-1 h-11 rounded-xl text-sm font-semibold font-montserrat transition-all ${
                        gender === g
                          ? 'bg-gradient-interactive text-white'
                          : 'bg-cloud-grey text-ink-black/60 border border-steel-grey hover:border-int-blue'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 2 — Credentials
          ══════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="flex flex-col gap-4">

              {/* License Number */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Medical License Number *</label>
                <input
                  className={inputClass}
                  placeholder="e.g. MED-2024-XXXXX"
                  value={licenseNumber}
                  onChange={e => setLicenseNumber(e.target.value)}
                  autoComplete="off"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              {/* Specialty dropdown */}
              <div ref={specialtyRef} className="relative">
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Specialty *</label>
                <button
                  type="button"
                  onClick={() => setShowSpecialtyDropdown(s => !s)}
                  className="w-full h-11 px-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-left flex items-center justify-between focus:outline-none focus:border-int-blue hover:border-int-blue/60 transition-colors"
                >
                  <span className={specialty ? 'text-ink-black' : 'text-ink-black/40'}>
                    {specialty || 'Select specialty'}
                  </span>
                  <svg
                    className={`w-4 h-4 text-ink-black/40 transition-transform ${showSpecialtyDropdown ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSpecialtyDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-steel-grey rounded-2xl shadow-card-lg z-50 max-h-56 overflow-y-auto">
                    {specialtiesList.map(sp => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => { setSpecialty(sp); setShowSpecialtyDropdown(false) }}
                        className={`w-full text-left px-4 py-3 text-sm font-montserrat flex items-center justify-between transition-colors first:rounded-t-2xl last:rounded-b-2xl ${
                          specialty === sp
                            ? 'bg-teal-50 text-teal-green font-semibold'
                            : 'text-ink-black hover:bg-cloud-grey'
                        }`}
                      >
                        {sp}
                        {specialty === sp && (
                          <svg className="w-4 h-4 text-teal-green flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Years of Experience — stepper */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-2">Years of Experience</label>
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setYearsExperience(e => Math.max(0, e - 1))}
                    className="w-11 h-11 rounded-xl bg-cloud-grey border border-steel-grey flex items-center justify-center text-ink-black text-xl font-bold hover:border-int-blue transition-colors"
                  >
                    −
                  </button>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-black text-ink-black font-montserrat">{yearsExperience}</span>
                    <span className="text-sm text-ink-black/50 font-montserrat">{yearsExperience === 1 ? 'year' : 'years'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setYearsExperience(e => Math.min(50, e + 1))}
                    className="w-11 h-11 rounded-xl bg-cloud-grey border border-steel-grey flex items-center justify-center text-ink-black text-xl font-bold hover:border-int-blue transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Hospital / Clinic */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Hospital / Clinic Name *</label>
                <input
                  className={inputClass}
                  placeholder="e.g. Tikur Anbessa Hospital"
                  value={hospitalName}
                  onChange={e => setHospitalName(e.target.value)}
                  autoComplete="off"
                />
              </div>

              {/* Short Bio */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">Short Bio</label>
                <textarea
                  className="w-full px-4 py-3 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue resize-none transition-colors"
                  rows={4}
                  placeholder="Tell patients about your experience, specialty, and approach to care…"
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, MAX_BIO))}
                  autoComplete="off"
                />
                <p className="text-[11px] text-ink-black/40 text-right mt-0.5 font-montserrat">{bio.length} / {MAX_BIO}</p>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 3 — Documents
          ══════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="flex flex-col gap-5">

              {/* Encryption note */}
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-2xl p-3.5">
                <svg className="w-5 h-5 text-info flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <p className="text-xs text-info/80 font-montserrat leading-relaxed">
                  Your documents are encrypted and securely stored. Only our admin team can access them for verification purposes.
                </p>
              </div>

              {/* Medical License — required, multiple */}
              <div>
                <label className="block text-xs font-bold text-ink-black/50 mb-1.5">
                  📄 Medical License * <span className="font-normal">(PDF or image, multiple allowed)</span>
                </label>

                {licenseFiles.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {licenseFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                        <span className="text-base">{fileIcon(f)}</span>
                        <span className="text-sm text-ink-black flex-1 truncate font-montserrat">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setLicenseFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-danger text-xs font-bold hover:opacity-70 flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl border border-dashed border-care-blue bg-blue-50 cursor-pointer hover:bg-blue-100 transition-colors">
                  <span className="text-care-blue text-xl leading-none">+</span>
                  <span className="text-sm text-care-blue font-semibold font-montserrat">
                    {licenseFiles.length === 0 ? 'Upload Medical License' : 'Add Another Document'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) setLicenseFiles(prev => [...prev, f])
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>

              {/* ID Document — optional */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs font-bold text-ink-black/50">🪪 ID Document</label>
                  <span className="text-[10px] font-semibold text-ink-black/40 bg-ink-black/5 rounded px-2 py-0.5">Optional</span>
                </div>

                {/* Type toggle */}
                <div className="flex gap-2 mb-3">
                  {(['national_id', 'passport'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => switchIdType(type)}
                      className={`flex-1 h-10 rounded-xl text-xs font-semibold font-montserrat transition-colors ${
                        idDocType === type
                          ? 'bg-gradient-interactive text-white'
                          : 'bg-cloud-grey text-ink-black/60 border border-steel-grey hover:border-int-blue'
                      }`}
                    >
                      {type === 'national_id' ? '🪪 National ID' : '📗 Passport'}
                    </button>
                  ))}
                </div>

                {idDocType === 'national_id' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2 bg-blue-50 rounded-xl p-2.5 mb-1">
                      <svg className="w-4 h-4 text-info flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-info/80 font-montserrat">
                        Upload both the <strong>front</strong> and <strong>back</strong> of your national ID.
                      </p>
                    </div>
                    {[
                      { label: 'Front side', file: idFrontFile, set: setIdFrontFile },
                      { label: 'Back side', file: idBackFile, set: setIdBackFile },
                    ].map(({ label, file, set }) => (
                      <div key={label}>
                        <p className="text-xs font-semibold text-ink-black/50 mb-1 font-montserrat">{label}</p>
                        <label className={`flex items-center gap-3 w-full px-4 py-3 rounded-2xl border cursor-pointer transition-colors ${
                          file
                            ? 'bg-green-50 border-green-200'
                            : 'border-dashed border-steel-grey bg-cloud-grey hover:border-int-blue'
                        }`}>
                          <span className="text-base">{file ? fileIcon(file) : '📎'}</span>
                          <span className={`text-sm flex-1 truncate font-montserrat ${file ? 'text-ink-black' : 'text-ink-black/60'}`}>
                            {file ? file.name : `${label} — PDF or image…`}
                          </span>
                          {file && (
                            <button
                              type="button"
                              onClick={e => { e.preventDefault(); set(null) }}
                              className="text-danger text-xs font-bold hover:opacity-70 flex-shrink-0"
                            >
                              ✕
                            </button>
                          )}
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => set(e.target.files?.[0] ?? null)} />
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {idDocType === 'passport' && (
                  <div>
                    <div className="flex items-start gap-2 bg-blue-50 rounded-xl p-2.5 mb-2">
                      <svg className="w-4 h-4 text-info flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-info/80 font-montserrat">Upload the photo page of your passport.</p>
                    </div>
                    <label className={`flex items-center gap-3 w-full px-4 py-3 rounded-2xl border cursor-pointer transition-colors ${
                      idFrontFile
                        ? 'bg-green-50 border-green-200'
                        : 'border-dashed border-steel-grey bg-cloud-grey hover:border-int-blue'
                    }`}>
                      <span className="text-base">{idFrontFile ? fileIcon(idFrontFile) : '📎'}</span>
                      <span className={`text-sm flex-1 truncate font-montserrat ${idFrontFile ? 'text-ink-black' : 'text-ink-black/60'}`}>
                        {idFrontFile ? idFrontFile.name : 'Passport photo page — PDF or image…'}
                      </span>
                      {idFrontFile && (
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); setIdFrontFile(null) }}
                          className="text-danger text-xs font-bold hover:opacity-70 flex-shrink-0"
                        >
                          ✕
                        </button>
                      )}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setIdFrontFile(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                )}
              </div>

              {!step3Valid && (
                <p className="text-xs text-warning font-medium font-montserrat">
                  {licenseFiles.length === 0
                    ? '⚠️ Upload at least one medical license document'
                    : idDocType === 'national_id'
                    ? '⚠️ Upload both the front and back of your national ID'
                    : idDocType === 'passport'
                    ? '⚠️ Upload your passport photo page'
                    : ''}
                </p>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 4 — Pricing
          ══════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="flex flex-col gap-4">

              {/* Revenue note */}
              <div className="flex items-start gap-3 bg-teal-50 border border-teal-100 rounded-2xl p-3.5">
                <svg className="w-5 h-5 text-teal-green flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
                <p className="text-xs text-ink-black font-montserrat leading-relaxed">
                  You keep <strong className="text-teal-green">80%</strong> of each consultation fee.
                  A <strong>20% platform fee</strong> supports Dawa operations and infrastructure.
                </p>
              </div>

              {/* Price cards */}
              {([
                { icon: '💬', label: 'Chat Consultation', desc: 'Text-based conversation', price: chatPrice, setPrice: setChatPrice },
                { icon: '📞', label: 'Phone Consultation', desc: 'Audio call session', price: phonePrice, setPrice: setPhonePrice },
                { icon: '🎥', label: 'Video Consultation', desc: 'Video call session', price: videoPrice, setPrice: setVideoPrice },
              ] as const).map(({ icon, label, desc, price, setPrice }) => (
                <div key={label} className="flex items-center gap-4 bg-white border border-steel-grey rounded-2xl p-4 shadow-card">
                  <div className="w-12 h-12 rounded-xl bg-cloud-grey flex items-center justify-center text-2xl flex-shrink-0">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-ink-black font-montserrat">{label}</p>
                    <p className="text-xs text-ink-black/50 mt-0.5 font-montserrat">{desc}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs font-semibold text-ink-black/50 font-montserrat">ETB</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="0"
                      value={price}
                      onChange={e => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-20 h-10 text-center border border-steel-grey rounded-xl font-montserrat font-bold text-base text-ink-black focus:outline-none focus:border-int-blue bg-cloud-grey transition-colors"
                    />
                  </div>
                </div>
              ))}

              <p className="text-xs text-ink-black/40 text-center font-montserrat">
                You can update your prices at any time from your profile settings.
              </p>

              {/* Earnings preview — shows once all 3 prices are entered */}
              {step4Valid && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mt-1">
                  <p className="font-bold text-sm text-green-700 font-montserrat mb-0.5">Earnings Preview</p>
                  <p className="text-xs text-ink-black/50 font-montserrat mb-3">After 20% platform fee, per session you earn:</p>
                  {[
                    { icon: '💬', label: 'Chat', price: chatPrice },
                    { icon: '📞', label: 'Phone', price: phonePrice },
                    { icon: '🎥', label: 'Video', price: videoPrice },
                  ].map(({ icon, label, price: p }) => {
                    const net = p ? Math.floor(Number(p) * 0.8) : 0
                    return (
                      <div key={label} className="flex items-center gap-2 py-2 border-b border-green-100 last:border-0">
                        <span className="text-base">{icon}</span>
                        <span className="flex-1 text-sm text-ink-black font-montserrat">{label}</span>
                        <span className="font-bold text-sm text-green-700 font-montserrat">ETB {net.toLocaleString()}</span>
                        <span className="text-xs text-ink-black/40 font-montserrat">/ session</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {error && <p className="text-danger text-xs text-center font-montserrat">{error}</p>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(s => s - 1)}
                className="btn-outline flex-1 h-12 rounded-2xl"
              >
                ← Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!stepValid[step]}
                className="btn-primary flex-1 h-12 rounded-2xl disabled:opacity-50"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!step4Valid || submitting}
                className="btn-primary flex-1 h-12 rounded-2xl disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : '🚀 Submit Application'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
