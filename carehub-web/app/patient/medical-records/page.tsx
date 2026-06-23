'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { formatDate, stripDrPrefix } from '@/lib/utils'

type Category = 'all' | 'summary' | 'prescription' | 'documents'

interface MedicalRecord {
  id: string
  consultation_id: string
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  created_at: string
  consultation: {
    type: string
    doctor_profile: {
      user: { full_name: string } | null
    } | null
  } | null
}

interface UploadedDoc {
  id: string
  name: string
  created_at: string
  path: string
}

const CATEGORY_LABELS: { key: Category; label: string; icon: string }[] = [
  { key: 'all', label: 'All Records', icon: '📋' },
  { key: 'summary', label: 'Summaries', icon: '📄' },
  { key: 'prescription', label: 'Prescriptions', icon: '💊' },
  { key: 'documents', label: 'My Documents', icon: '📁' },
]

export default function PatientMedicalRecordsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!ud) { setLoading(false); return }
      setSupabaseUserId((ud as any).id)

      const [summaryRes, docsRes] = await Promise.all([
        client
          .from('consultation_summaries')
          .select(`
            id, consultation_id, chief_complaint, diagnosis, prescription,
            followup_recommendation, created_at,
            consultation:consultations!consultation_id(
              type,
              doctor_profile:doctor_profiles!doctor_id(user:users!user_id(full_name))
            )
          `)
          .eq('consultations.patient_id', (ud as any).id)
          .order('created_at', { ascending: false }),
        client.storage
          .from('patient-documents')
          .list((ud as any).id, { sortBy: { column: 'created_at', order: 'desc' } }),
      ])

      setRecords((summaryRes.data ?? []) as unknown as MedicalRecord[])
      setUploadedDocs((docsRes.data ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        created_at: f.created_at ?? new Date().toISOString(),
        path: `${(ud as any).id}/${f.name}`,
      })))
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !supabaseUserId) return
    setUploadError('')
    setUploading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const path = `${supabaseUserId}/${Date.now()}_${file.name}`
      const { error } = await getAuthClient(token)
        .storage
        .from('patient-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw error
      setUploadedDocs(prev => [{
        id: path,
        name: file.name,
        created_at: new Date().toISOString(),
        path,
      }, ...prev])
      setCategory('documents')
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const filteredRecords = records.filter(r => {
    if (category === 'prescription') return !!r.prescription
    if (category === 'summary') return !!r.diagnosis || !!r.chief_complaint
    if (category === 'documents') return false
    return true
  })

  const typeIcon = (type: string) =>
    type === 'chat' ? '💬' : type === 'phone' ? '📞' : '🎥'

  const showDocs = category === 'documents' || category === 'all'
  const showRecords = category !== 'documents'

  return (
    <div className="p-8 max-w-3xl">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">Medical Records</h1>
          <p className="text-ink-black/50 text-sm mt-1">Your consultation summaries, prescriptions, and uploaded documents</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-10 px-5 rounded-xl font-montserrat font-bold text-sm text-white flex items-center gap-2 disabled:opacity-60 flex-shrink-0"
          style={{ background: uploading ? '#9CA3AF' : 'linear-gradient(to right, #2962FF, #00BFA5)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {uploadError && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-sm text-danger font-montserrat font-semibold">
          {uploadError}
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORY_LABELS.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full font-montserrat font-semibold text-sm transition-all"
            style={category === c.key
              ? { background: 'linear-gradient(to right, #2962FF, #00BFA5)', color: '#fff' }
              : { background: '#F5F7FA', color: '#6B7280' }
            }
          >
            <span>{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 shimmer-bg rounded-2xl" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {showRecords && filteredRecords.map(record => {
            const isOpen = expanded === record.id
            const docName = record.consultation?.doctor_profile?.user?.full_name ?? 'Doctor'
            const type = record.consultation?.type ?? 'chat'
            const hasRx = !!record.prescription

            return (
              <div key={record.id} className="card overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : record.id)}
                  className="w-full flex items-center gap-4 p-5 hover:bg-cloud-grey transition-colors text-left"
                >
                  <div className="w-11 h-11 rounded-2xl bg-[#EFF6FF] flex items-center justify-center text-xl flex-shrink-0">
                    📄
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-montserrat font-bold text-sm text-ink-black">
                        Consultation Summary
                      </p>
                      {hasRx && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-green/10 text-teal-green">
                          💊 Rx
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-black/50">
                      {typeIcon(type)} Dr. {stripDrPrefix(docName)} · {formatDate(record.created_at)}
                    </p>
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="#9CA3AF" strokeWidth="2.5"
                    className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 border-t border-cloud-grey">
                    <div className="flex flex-col gap-4 pt-4">
                      {record.chief_complaint && (
                        <div>
                          <p className="text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Chief Complaint</p>
                          <p className="text-sm text-ink-black bg-cloud-grey rounded-xl px-4 py-3">{record.chief_complaint}</p>
                        </div>
                      )}
                      {record.diagnosis && (
                        <div>
                          <p className="text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Diagnosis</p>
                          <p className="text-sm text-ink-black bg-cloud-grey rounded-xl px-4 py-3">{record.diagnosis}</p>
                        </div>
                      )}
                      {record.prescription && (
                        <div>
                          <p className="text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Prescription</p>
                          <p className="text-sm text-ink-black bg-teal-green/5 border border-teal-green/20 rounded-xl px-4 py-3">{record.prescription}</p>
                        </div>
                      )}
                      {record.followup_recommendation && (
                        <div>
                          <p className="text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-1.5">Follow-up</p>
                          <p className="text-sm text-ink-black bg-cloud-grey rounded-xl px-4 py-3">{record.followup_recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {showDocs && uploadedDocs.map(doc => {
            const isPdf = doc.name.toLowerCase().endsWith('.pdf')
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.name)
            return (
              <div key={doc.id} className="card flex items-center gap-4 p-5">
                <div className="w-11 h-11 rounded-2xl bg-int-blue/8 flex items-center justify-center text-xl flex-shrink-0">
                  {isPdf ? '📄' : isImage ? '🖼️' : '📎'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat font-bold text-sm text-ink-black truncate">{doc.name}</p>
                  <p className="text-xs text-ink-black/50 mt-0.5">
                    Uploaded by you · {formatDate(doc.created_at)}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-int-blue/10 text-int-blue flex-shrink-0">
                  My Document
                </span>
              </div>
            )
          })}

          {showRecords && filteredRecords.length === 0 && !showDocs && (
            <div className="card p-14 text-center">
              <p className="text-4xl mb-4">📋</p>
              <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No records yet</p>
              <p className="text-ink-black/50 text-sm">Your medical records will appear here after consultations.</p>
            </div>
          )}

          {category === 'documents' && uploadedDocs.length === 0 && (
            <div className="card p-14 text-center">
              <p className="text-4xl mb-4">📁</p>
              <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No documents yet</p>
              <p className="text-ink-black/50 text-sm">Upload PDFs or images using the button above.</p>
            </div>
          )}

          {category === 'all' && filteredRecords.length === 0 && uploadedDocs.length === 0 && (
            <div className="card p-14 text-center">
              <p className="text-4xl mb-4">📋</p>
              <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No records yet</p>
              <p className="text-ink-black/50 text-sm">Your medical records and uploaded documents will appear here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
