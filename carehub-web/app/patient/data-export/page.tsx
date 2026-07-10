'use client'

import { useState } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

type ExportFormat = 'csv' | 'json'

export default function PatientDataExportPage() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const [loading, setLoading] = useState<string | null>(null)
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [error, setError] = useState('')

  async function getUserId() {
    const token = await getToken()
    if (!token || !user) return null
    const client = getAuthClient(token)
    const { data } = await client.from('users').select('id').eq('clerk_id', user.id).single()
    return { token, userId: (data as any)?.id as string | undefined }
  }

  async function exportConsultations() {
    setError(''); setLoading('consultations')
    try {
      const auth = await getUserId()
      if (!auth?.userId || !auth.token) { setError('Authentication failed'); return }
      const client = getAuthClient(auth.token)

      const { data } = await client
        .from('consultations')
        .select(`
          id, type, status, scheduled_at, started_at, ended_at, duration_minutes,
          patient_amount, created_at,
          doctor:doctor_profiles!doctor_id(user:users(full_name), specialty, hospital_name),
          consultation_summaries(chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed)
        `)
        .eq('patient_id', auth.userId)
        .order('created_at', { ascending: false })

      const rows = (data ?? []) as any[]

      if (format === 'csv') {
        const headers = ['ID', 'Type', 'Status', 'Doctor', 'Specialty', 'Hospital', 'Scheduled At', 'Started At', 'Duration (min)', 'Amount (ETB)', 'Chief Complaint', 'Diagnosis', 'Prescription', 'Follow-up', 'Referral Needed']
        const csv = [
          headers.join(','),
          ...rows.map(r => {
            const sum = r.consultation_summaries?.[0]
            return [
              r.id, r.type, r.status,
              r.doctor?.user?.full_name ?? '',
              r.doctor?.specialty ?? '',
              r.doctor?.hospital_name ?? '',
              r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : '',
              r.started_at ? new Date(r.started_at).toLocaleString() : '',
              r.duration_minutes ?? '',
              r.patient_amount ?? '',
              sum?.chief_complaint ?? '', sum?.diagnosis ?? '', sum?.prescription ?? '',
              sum?.followup_recommendation ?? '', sum?.referral_needed ? 'Yes' : 'No',
            ].map(v => JSON.stringify(v ?? '')).join(',')
          }),
        ].join('\n')
        download(csv, `dawa_consultations_${today()}.csv`, 'text/csv')
      } else {
        download(JSON.stringify(rows, null, 2), `dawa_consultations_${today()}.json`, 'application/json')
      }
    } catch { setError('Export failed. Please try again.') }
    finally { setLoading(null) }
  }

  async function exportDocuments() {
    setError(''); setLoading('documents')
    try {
      const auth = await getUserId()
      if (!auth?.userId || !auth.token) { setError('Authentication failed'); return }
      const client = getAuthClient(auth.token)

      const { data: files } = await client.storage.from('patient-documents').list(auth.userId)
      const rows = (files ?? []).map((f: any) => ({
        name: f.name,
        size_bytes: f.metadata?.size ?? 0,
        created_at: f.created_at,
        updated_at: f.updated_at,
      }))

      if (format === 'csv') {
        const csv = ['Name,Size (bytes),Created At,Updated At',
          ...rows.map(r => `${JSON.stringify(r.name)},${r.size_bytes},${r.created_at ?? ''},${r.updated_at ?? ''}`)
        ].join('\n')
        download(csv, `dawa_documents_${today()}.csv`, 'text/csv')
      } else {
        download(JSON.stringify(rows, null, 2), `dawa_documents_${today()}.json`, 'application/json')
      }
    } catch { setError('Export failed. Please try again.') }
    finally { setLoading(null) }
  }

  async function exportAll() {
    setError(''); setLoading('all')
    try {
      const auth = await getUserId()
      if (!auth?.userId || !auth.token) { setError('Authentication failed'); return }
      const client = getAuthClient(auth.token)

      const [{ data: consultations }, { data: files }] = await Promise.all([
        client
          .from('consultations')
          .select(`
            id, type, status, scheduled_at, started_at, ended_at, duration_minutes, patient_amount, created_at,
            doctor:doctor_profiles!doctor_id(user:users(full_name), specialty, hospital_name),
            consultation_summaries(chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed)
          `)
          .eq('patient_id', auth.userId)
          .order('created_at', { ascending: false }),
        client.storage.from('patient-documents').list(auth.userId),
      ])

      const exportData = {
        exported_at: new Date().toISOString(),
        patient_id: auth.userId,
        consultations: consultations ?? [],
        documents: (files ?? []).map((f: any) => ({ name: f.name, size: f.metadata?.size, created_at: f.created_at })),
      }

      download(JSON.stringify(exportData, null, 2), `dawa_full_export_${today()}.json`, 'application/json')
    } catch { setError('Export failed. Please try again.') }
    finally { setLoading(null) }
  }

  function download(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function today() { return new Date().toISOString().split('T')[0] }

  const exportItems = [
    {
      id: 'consultations',
      icon: '📋',
      title: 'Consultation History',
      description: 'All your consultations including doctor notes, diagnoses, and prescriptions.',
      action: exportConsultations,
    },
    {
      id: 'documents',
      icon: '📁',
      title: 'Medical Documents',
      description: 'List of all uploaded medical documents and lab reports.',
      action: exportDocuments,
    },
    {
      id: 'all',
      icon: '📦',
      title: 'Full Data Export',
      description: 'Complete export of all your medical data in a single JSON file.',
      action: exportAll,
      jsonOnly: true,
    },
  ]

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Export My Data</h1>
        <p className="text-ink-black/50 text-sm mt-1">Download a copy of your medical history and documents. Your data is yours.</p>
      </div>

      {/* Format selector */}
      <div className="card p-5 mb-6">
        <p className="font-montserrat font-semibold text-sm text-ink-black mb-3">Export Format</p>
        <div className="flex gap-3">
          {(['csv', 'json'] as ExportFormat[]).map(f => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`flex-1 py-3 rounded-xl border-2 font-montserrat font-bold text-sm uppercase tracking-wide transition-all ${
                format === f
                  ? 'border-teal-green bg-teal-green/10 text-teal-green'
                  : 'border-steel-grey text-ink-black/50 hover:border-ink-black/40'
              }`}
            >
              {f.toUpperCase()}
              {f === 'csv' && <span className="block text-[10px] font-normal normal-case tracking-normal opacity-60">Open in Excel / Sheets</span>}
              {f === 'json' && <span className="block text-[10px] font-normal normal-case tracking-normal opacity-60">Developer / portable</span>}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-montserrat">
          {error}
        </div>
      )}

      {/* Export sections */}
      <div className="flex flex-col gap-4">
        {exportItems.map(item => (
          <div key={item.id} className="card p-6 flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-cloud-grey flex items-center justify-center text-2xl flex-shrink-0">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-montserrat font-bold text-sm text-ink-black">{item.title}</p>
              <p className="text-ink-black/50 text-xs mt-0.5 leading-relaxed">{item.description}</p>
              {item.jsonOnly && format === 'csv' && (
                <p className="text-warning text-[10px] mt-1 font-semibold">Full export always uses JSON format</p>
              )}
            </div>
            <button
              onClick={item.action}
              disabled={loading !== null}
              className="flex-shrink-0 h-10 px-5 rounded-xl bg-gradient-interactive text-white font-montserrat font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
              aria-label={`Export ${item.title}`}
            >
              {loading === item.id ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : '⬇'}
              {loading === item.id ? 'Exporting…' : 'Export'}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 px-5 py-4 rounded-2xl bg-info/8 border border-info/15">
        <p className="text-info text-xs font-montserrat leading-relaxed">
          <span className="font-bold">Privacy note:</span> Exported files are generated locally in your browser and never sent to any third party.
          All data is protected by our <a href="/patient/about" className="underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}
