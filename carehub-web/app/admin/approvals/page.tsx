'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface DoctorApplication {
  id: string
  user_id: string
  license_number: string
  specialty: string
  years_experience: number
  hospital_name: string
  bio: string
  license_doc_url: string | null
  id_doc_url: string | null
  status: string
  chat_price: number
  phone_price: number
  video_price: number
  date_of_birth: string | null
  gender: string | null
  created_at: string
  user: {
    full_name: string
    email: string
    phone: string | null
    profile_photo_url: string | null
  } | null
}

interface IdDocInfo {
  type: 'national_id' | 'passport'
  front?: string
  back?: string
  file?: string
}

function parseLicenseDocs(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'string') return [parsed]
  } catch {
    if (raw.trim()) return [raw]
  }
  return []
}

function parseIdDoc(raw: string | null): IdDocInfo | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as IdDocInfo
  } catch {
    return { type: 'passport', file: raw }
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function ApprovalsPage() {
  const [applications, setApplications] = useState<DoctorApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState<{ [id: string]: string }>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/pending-doctors')
      if (!res.ok) throw new Error(await res.text())
      const data: DoctorApplication[] = await res.json()
      setApplications(data)
    } catch (err) {
      console.error('Failed to load pending doctors:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    const hash = window.location.hash
    if (hash.startsWith('#doctor-')) {
      const id = hash.replace('#doctor-', '')
      setExpanded(id)
      setTimeout(() => {
        document.getElementById(`doctor-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 600)
    }

    const channel = supabase
      .channel('admin-approvals-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'doctor_profiles', filter: 'status=eq.pending' },
        () => { load() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  function notifySidebar() {
    window.dispatchEvent(new CustomEvent('pending-doctors-changed'))
  }

  async function handleApprove(id: string) {
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/pending-doctors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Approval failed: ${body.error ?? res.statusText}`)
        return
      }
      setApplications(prev => prev.filter(a => a.id !== id))
      notifySidebar()
    } finally {
      setProcessing(null)
    }
  }

  async function handleReject(id: string) {
    const reason = rejectionReason[id] ?? ''
    if (!reason.trim()) {
      alert('Please enter a rejection reason before rejecting.')
      return
    }
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/pending-doctors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Rejection failed: ${body.error ?? res.statusText}`)
        return
      }
      setApplications(prev => prev.filter(a => a.id !== id))
      notifySidebar()
    } finally {
      setProcessing(null)
    }
  }

  async function openDocument(path: string, label: string) {
    const key = `${path}-${label}`
    setDocLoading(key)
    try {
      if (path.startsWith('http')) {
        window.open(path, '_blank')
        return
      }
      const { data, error } = await supabase.storage
        .from('doctor-documents')
        .createSignedUrl(path, 3600)
      if (error || !data?.signedUrl) {
        alert(`Could not open "${label}". The file may not exist or you may not have permission.`)
        return
      }
      window.open(data.signedUrl, '_blank')
    } finally {
      setDocLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-ink-black/40 text-sm">Loading applications…</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Doctor Approvals</h1>
        <p className="text-ink-black/50 text-sm mt-1">
          {applications.length === 0
            ? 'No pending applications — all caught up!'
            : `${applications.length} application${applications.length > 1 ? 's' : ''} waiting for review`}
        </p>
      </div>

      {applications.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <p className="font-montserrat font-bold text-xl text-ink-black mb-2">All caught up!</p>
          <p className="text-ink-black/50 text-sm">No pending doctor applications.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {applications.map(app => {
            const licenseDocs = parseLicenseDocs(app.license_doc_url)
            const idDoc = parseIdDoc(app.id_doc_url)

            return (
              <div key={app.id} id={`doctor-${app.id}`} className="card overflow-hidden scroll-mt-4 border border-steel-grey">
                {/* Collapse header */}
                <button
                  onClick={() => setExpanded(expanded === app.id ? null : app.id)}
                  className="w-full flex items-center gap-4 p-5 text-left hover:bg-cloud-grey/50 transition-colors"
                >
                  <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg flex-shrink-0 overflow-hidden">
                    {app.user?.profile_photo_url
                      ? <img src={app.user.profile_photo_url} alt="" className="w-full h-full object-cover" />
                      : app.user?.full_name?.charAt(0) ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-montserrat font-bold text-base text-ink-black">{app.user?.full_name ?? 'Unknown'}</p>
                    <p className="text-ink-black/50 text-sm truncate">
                      {[app.specialty, app.years_experience ? `${app.years_experience}yr exp` : null, app.hospital_name].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs bg-warning/10 text-warning font-semibold px-2.5 py-1 rounded-full">Pending</span>
                    <span className="text-xs text-ink-black/40">{new Date(app.created_at).toLocaleDateString()}</span>
                    <span className="text-ink-black/40 text-xs">{expanded === app.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded detail */}
                {expanded === app.id && (
                  <div className="border-t border-steel-grey">

                    {/* Step 1 — Personal Information */}
                    <Section label="Step 1 — Personal Information" step={1}>
                      <div className="flex items-start gap-5">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-2xl flex-shrink-0 overflow-hidden">
                          {app.user?.profile_photo_url
                            ? <img src={app.user.profile_photo_url} alt="Profile" className="w-full h-full object-cover" />
                            : app.user?.full_name?.charAt(0) ?? '?'}
                        </div>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3 flex-1">
                          <Field label="Full Name" value={app.user?.full_name} />
                          <Field label="Email" value={app.user?.email} />
                          <Field label="Phone" value={app.user?.phone} />
                          <Field label="Date of Birth" value={formatDate(app.date_of_birth)} />
                          <Field label="Gender" value={app.gender} />
                        </div>
                      </div>
                    </Section>

                    {/* Step 2 — Professional Details */}
                    <Section label="Step 2 — Professional Details" step={2}>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-4">
                        <Field label="Medical License #" value={app.license_number} mono />
                        <Field label="Specialty" value={app.specialty} />
                        <Field label="Years of Experience" value={app.years_experience != null ? `${app.years_experience} years` : undefined} />
                        <Field label="Hospital / Clinic" value={app.hospital_name} />
                      </div>
                      {app.bio && (
                        <div>
                          <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Bio</p>
                          <p className="text-sm text-ink-black/70 bg-cloud-grey rounded-xl p-3 leading-relaxed">{app.bio}</p>
                        </div>
                      )}
                    </Section>

                    {/* Step 3 — Documents */}
                    <Section label="Step 3 — Documents" step={3}>
                      {/* License documents */}
                      <div className="mb-4">
                        <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">
                          Medical License Document{licenseDocs.length > 1 ? 's' : ''} ({licenseDocs.length})
                        </p>
                        {licenseDocs.length === 0 ? (
                          <p className="text-sm text-ink-black/40 italic">No license documents uploaded.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {licenseDocs.map((docPath, i) => {
                              const filename = docPath.split('/').pop() ?? `License ${i + 1}`
                              const isPdf = docPath.toLowerCase().endsWith('.pdf')
                              const loadKey = `${docPath}-License ${i + 1}`
                              return (
                                <button
                                  key={i}
                                  onClick={() => openDocument(docPath, `License ${i + 1}`)}
                                  disabled={docLoading === loadKey}
                                  className="flex items-center gap-2 h-10 px-4 text-xs rounded-xl border border-steel-grey bg-white hover:bg-cloud-grey transition-colors font-semibold text-ink-black disabled:opacity-50"
                                >
                                  <span>{isPdf ? '📄' : '🖼️'}</span>
                                  <span className="max-w-[160px] truncate">{filename}</span>
                                  {docLoading === loadKey && <span className="animate-spin text-xs">⟳</span>}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* ID document */}
                      <div>
                        <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">
                          Identity Document
                          {idDoc && (
                            <span className="ml-2 normal-case font-medium text-int-blue">
                              {idDoc.type === 'national_id' ? '(National ID)' : '(Passport)'}
                            </span>
                          )}
                        </p>
                        {!idDoc ? (
                          <p className="text-sm text-ink-black/40 italic">No ID document uploaded.</p>
                        ) : idDoc.type === 'national_id' ? (
                          <div className="flex flex-wrap gap-2">
                            {idDoc.front && (
                              <DocButton
                                path={idDoc.front}
                                label="ID Front"
                                docLoading={docLoading}
                                onOpen={openDocument}
                              />
                            )}
                            {idDoc.back && (
                              <DocButton
                                path={idDoc.back}
                                label="ID Back"
                                docLoading={docLoading}
                                onOpen={openDocument}
                              />
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(idDoc.file || idDoc.front) && (
                              <DocButton
                                path={(idDoc.file || idDoc.front)!}
                                label="Passport"
                                docLoading={docLoading}
                                onOpen={openDocument}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </Section>

                    {/* Step 4 — Pricing */}
                    <Section label="Step 4 — Consultation Pricing" step={4}>
                      <div className="grid grid-cols-3 gap-4">
                        <PriceCard icon="💬" label="Chat" price={app.chat_price} />
                        <PriceCard icon="📞" label="Phone Call" price={app.phone_price} />
                        <PriceCard icon="🎥" label="Video Call" price={app.video_price} />
                      </div>
                    </Section>

                    {/* Actions */}
                    <div className="p-5 bg-cloud-grey/50 border-t border-steel-grey">
                      <textarea
                        placeholder="Rejection reason (required only when rejecting)…"
                        value={rejectionReason[app.id] ?? ''}
                        onChange={e => setRejectionReason(prev => ({ ...prev, [app.id]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-2xl border border-steel-grey bg-white px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue mb-3 resize-none"
                      />
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleApprove(app.id)}
                          disabled={processing === app.id}
                          className="btn-primary h-11 px-6 text-sm rounded-xl flex-1 disabled:opacity-50 font-semibold"
                        >
                          {processing === app.id ? 'Processing…' : '✅ Approve Application'}
                        </button>
                        <button
                          onClick={() => handleReject(app.id)}
                          disabled={processing === app.id}
                          className="h-11 px-6 text-sm rounded-xl flex-1 bg-red-50 text-red-600 border border-red-200 font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          {processing === app.id ? 'Processing…' : '❌ Reject Application'}
                        </button>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Small helper components ─────────────────────────────────────────── */

function Section({ label, step, children }: { label: string; step: number; children: React.ReactNode }) {
  return (
    <div className="p-5 border-b border-steel-grey">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-6 h-6 rounded-full bg-gradient-hero text-white text-xs font-black flex items-center justify-center flex-shrink-0">
          {step}
        </span>
        <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider">{label}</p>
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm font-semibold text-ink-black ${mono ? 'font-mono' : ''}`}>
        {value != null && value !== '' ? String(value) : <span className="text-ink-black/30 font-normal">—</span>}
      </p>
    </div>
  )
}

function PriceCard({ icon, label, price }: { icon: string; label: string; price: number }) {
  const net = Math.floor((price ?? 0) * 0.8)
  return (
    <div className="bg-white rounded-2xl border border-steel-grey p-4 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-black text-ink-black">ETB {price ?? 0}</p>
      <p className="text-[10px] text-teal-green font-semibold mt-0.5">Doctor earns ETB {net}</p>
    </div>
  )
}

function DocButton({
  path,
  label,
  docLoading,
  onOpen,
}: {
  path: string
  label: string
  docLoading: string | null
  onOpen: (path: string, label: string) => void
}) {
  const filename = path.split('/').pop() ?? label
  const isPdf = path.toLowerCase().endsWith('.pdf')
  const loadKey = `${path}-${label}`
  return (
    <button
      onClick={() => onOpen(path, label)}
      disabled={docLoading === loadKey}
      className="flex items-center gap-2 h-10 px-4 text-xs rounded-xl border border-steel-grey bg-white hover:bg-cloud-grey transition-colors font-semibold text-ink-black disabled:opacity-50"
    >
      <span>{isPdf ? '📄' : '🪪'}</span>
      <span>{label}</span>
      <span className="text-ink-black/30 max-w-[120px] truncate">({filename})</span>
      {docLoading === loadKey && <span className="animate-spin text-xs">⟳</span>}
    </button>
  )
}
