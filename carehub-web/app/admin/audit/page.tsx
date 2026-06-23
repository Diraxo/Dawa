'use client'

import { useEffect, useState } from 'react'

// Audit log is server-only data (admin_logs RLS blocks all client reads).
// Fetched via /api/admin/audit which uses supabaseAdmin (service role).

interface AuditEntry {
  id: string
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
  admin: { full_name: string | null; email: string } | null
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  approve_doctor:        { label: 'Approved Doctor',        color: 'bg-success/10 text-success' },
  reject_doctor:         { label: 'Rejected Doctor',        color: 'bg-danger/10 text-danger' },
  suspend_doctor:        { label: 'Suspended Doctor',       color: 'bg-warning/10 text-warning' },
  reinstate_doctor:      { label: 'Reinstated Doctor',      color: 'bg-int-blue/10 text-int-blue' },
  suspend_patient:       { label: 'Suspended Patient',      color: 'bg-warning/10 text-warning' },
  unsuspend_patient:     { label: 'Unsuspended Patient',    color: 'bg-success/10 text-success' },
  cancel_consultation:   { label: 'Cancelled Consultation', color: 'bg-danger/10 text-danger' },
  withdrawal_approve:    { label: 'Approved Withdrawal',    color: 'bg-success/10 text-success' },
  withdrawal_reject:     { label: 'Rejected Withdrawal',    color: 'bg-danger/10 text-danger' },
  withdrawal_paid:       { label: 'Marked Withdrawal Paid', color: 'bg-teal-green/10 text-teal-green' },
}

function formatMeta(meta: Record<string, unknown> | null) {
  if (!meta) return '—'
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const PAGE_SIZE = 50

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/admin/audit?page=${page}&limit=${PAGE_SIZE}`)
      if (res.ok) {
        const { entries: data, total: t } = await res.json()
        setEntries(data ?? [])
        setTotal(t ?? 0)
      }
      setLoading(false)
    }
    load()
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Audit Log</h1>
        <p className="text-ink-black/50 text-sm mt-1">
          Every admin action is recorded here for accountability and security review.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-steel-grey">
                {['When', 'Admin', 'Action', 'Details'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="text-ink-black/50 text-sm">No audit entries yet.</p>
                    <p className="text-ink-black/30 text-xs mt-1">Admin actions (approve/reject/suspend/cancel) will appear here.</p>
                  </td>
                </tr>
              ) : entries.map((e, i) => {
                const style = ACTION_LABELS[e.action]
                return (
                  <tr key={e.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                    <td className="px-4 py-3 text-xs text-ink-black/50 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-black">
                      {e.admin?.full_name ?? e.admin?.email ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                        style?.color ?? 'bg-steel-grey/20 text-ink-black/60'
                      }`}>
                        {style?.label ?? e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-black/50 max-w-xs truncate">
                      {formatMeta(e.metadata)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-steel-grey">
            <span className="text-xs text-ink-black/40">
              Page {page + 1} of {totalPages} · {total} entries
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-8 px-3 rounded-xl border border-steel-grey text-xs font-semibold text-ink-black/60 hover:bg-cloud-grey disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="h-8 px-3 rounded-xl border border-steel-grey text-xs font-semibold text-ink-black/60 hover:bg-cloud-grey disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
