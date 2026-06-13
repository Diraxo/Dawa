'use client'

import { useEffect, useState } from 'react'
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
  created_at: string
  user: {
    full_name: string
    email: string
    profile_photo_url: string | null
  } | null
}

export default function ApprovalsPage() {
  const [applications, setApplications] = useState<DoctorApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState<{ [id: string]: string }>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('doctor_profiles')
      .select('*, user:users(full_name, email, profile_photo_url)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setApplications((data ?? []) as unknown as DoctorApplication[])
    setLoading(false)
  }

  async function handleApprove(id: string) {
    setProcessing(id)
    const app = applications.find(a => a.id === id)
    const { error } = await supabase
      .from('doctor_profiles')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      alert(`Approval failed: ${error.message}`)
      setProcessing(null)
      return
    }
    if (app) {
      await supabase.from('notifications').insert({
        user_id: app.user_id,
        title: 'Application Approved 🎉',
        body: 'Congratulations! Your doctor application has been approved. You can now go online and start receiving consultations.',
        type: 'doctor_approved',
        data_json: { doctorProfileId: id },
      })
    }
    setApplications(prev => prev.filter(a => a.id !== id))
    setProcessing(null)
  }

  async function handleReject(id: string) {
    const reason = rejectionReason[id] ?? ''
    if (!reason.trim()) {
      alert('Please enter a rejection reason before rejecting.')
      return
    }
    setProcessing(id)
    const app = applications.find(a => a.id === id)
    const { error } = await supabase
      .from('doctor_profiles')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)
    if (error) {
      alert(`Rejection failed: ${error.message}`)
      setProcessing(null)
      return
    }
    if (app) {
      await supabase.from('notifications').insert({
        user_id: app.user_id,
        title: 'Application Not Approved',
        body: `Your doctor application was not approved. Reason: ${reason}`,
        type: 'doctor_rejected',
        data_json: { doctorProfileId: id },
      })
    }
    setApplications(prev => prev.filter(a => a.id !== id))
    setProcessing(null)
  }

  // Documents live in the private doctor-documents bucket — open via signed URL
  async function openDocument(path: string) {
    if (path.startsWith('http')) {
      window.open(path, '_blank')
      return
    }
    const { data, error } = await supabase.storage
      .from('doctor-documents')
      .createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) {
      alert('Could not open document. Please try again.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-ink-black/40 text-sm">Loading applications…</div>
      </div>
    )
  }

  return (
    <div className="p-8">
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
          {applications.map(app => (
            <div key={app.id} className="card overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpanded(expanded === app.id ? null : app.id)}
                className="w-full flex items-center gap-4 p-5 text-left hover:bg-cloud-grey/50 transition-colors"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg flex-shrink-0">
                  {app.user?.full_name?.charAt(0) ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-base text-ink-black">{app.user?.full_name ?? 'Unknown'}</p>
                  <p className="text-ink-black/50 text-sm">{app.specialty} · {app.years_experience}yr exp · {app.hospital_name}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-ink-black/40">
                    {new Date(app.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-ink-black/40">{expanded === app.id ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded detail */}
              {expanded === app.id && (
                <div className="px-5 pb-5 border-t border-steel-grey">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 mb-4">
                    <div>
                      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">License</p>
                      <p className="text-sm font-semibold text-ink-black">{app.license_number}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Email</p>
                      <p className="text-sm font-semibold text-ink-black">{app.user?.email}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Chat Price</p>
                      <p className="text-sm font-semibold text-ink-black">ETB {app.chat_price}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-0.5">Video Price</p>
                      <p className="text-sm font-semibold text-ink-black">ETB {app.video_price}</p>
                    </div>
                  </div>

                  {app.bio && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-1">Bio</p>
                      <p className="text-sm text-ink-black/70 bg-cloud-grey rounded-xl p-3">{app.bio}</p>
                    </div>
                  )}

                  {/* Document links */}
                  <div className="flex gap-2 mb-4">
                    {app.license_doc_url && (
                      <button onClick={() => openDocument(app.license_doc_url!)}
                        className="btn-outline h-9 px-4 text-xs rounded-xl">
                        📄 License Doc
                      </button>
                    )}
                    {app.id_doc_url && (
                      <button onClick={() => openDocument(app.id_doc_url!)}
                        className="btn-outline h-9 px-4 text-xs rounded-xl">
                        🪪 ID Document
                      </button>
                    )}
                  </div>

                  {/* Rejection reason */}
                  <textarea
                    placeholder="Rejection reason (required only if rejecting)…"
                    value={rejectionReason[app.id] ?? ''}
                    onChange={e => setRejectionReason(prev => ({ ...prev, [app.id]: e.target.value }))}
                    rows={2}
                    className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue mb-4 resize-none"
                  />

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleApprove(app.id)}
                      disabled={processing === app.id}
                      className="btn-primary h-10 px-6 text-sm rounded-xl flex-1 disabled:opacity-50"
                    >
                      {processing === app.id ? '…' : '✅ Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(app.id)}
                      disabled={processing === app.id}
                      className="h-10 px-6 text-sm rounded-xl flex-1 bg-danger/10 text-danger border border-danger/20 font-semibold hover:bg-danger/20 transition-colors disabled:opacity-50"
                    >
                      {processing === app.id ? '…' : '❌ Reject'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
