'use client'

import { useCallback, useEffect, useState } from 'react'

// Audit log is server-only data (admin_logs RLS blocks all client reads).
// Fetched via /api/admin/audit which uses supabaseAdmin (service role).

interface AuditEntry {
  id: string
  action: string
  actor_role: string | null
  entity_type: string | null
  entity_id: string | null
  ip_address: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
  actor: { full_name: string | null; email: string } | null
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
  summary_edited:        { label: 'Summary Edited',         color: 'bg-int-blue/10 text-int-blue' },
  prescription_created:  { label: 'Prescription Created',   color: 'bg-success/10 text-success' },
  prescription_edited:   { label: 'Prescription Edited',    color: 'bg-warning/10 text-warning' },
  review_hidden:         { label: 'Review Hidden',          color: 'bg-danger/10 text-danger' },
  review_restored:       { label: 'Review Restored',        color: 'bg-success/10 text-success' },
  config_updated:        { label: 'Config Updated',         color: 'bg-warning/10 text-warning' },
  specialty_created:     { label: 'Specialty Created',      color: 'bg-success/10 text-success' },
  specialty_deleted:     { label: 'Specialty Deleted',      color: 'bg-danger/10 text-danger' },
}

const ALL_ACTIONS = Object.keys(ACTION_LABELS)

function formatMeta(meta: Record<string, unknown> | null) {
  if (!meta) return '—'
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

export default function AdminAuditPage() {
  const [entries, setEntries]   = useState<AuditEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(0)
  const [total, setTotal]       = useState(0)
  const [search, setSearch]     = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [exporting, setExporting] = useState(false)

  const PAGE_SIZE = 50

  const buildQuery = useCallback((overridePage?: number) => {
    const p = overridePage ?? page
    const params = new URLSearchParams({
      page:  String(p),
      limit: String(PAGE_SIZE),
    })
    if (search)       params.set('search',  search)
    if (actionFilter) params.set('action',  actionFilter)
    if (dateFrom)     params.set('from',    dateFrom)
    if (dateTo)       params.set('to',      dateTo)
    return params.toString()
  }, [page, search, actionFilter, dateFrom, dateTo])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/admin/audit?${buildQuery(0)}`)
      if (res.ok && !cancelled) {
        const { entries: data, total: t } = await res.json()
        setEntries(data ?? [])
        setTotal(t ?? 0)
        setPage(0)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  // Depend on filter values, not page (page is reset on filter change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, actionFilter, dateFrom, dateTo])

  // Separate effect for page navigation
  useEffect(() => {
    if (page === 0) return // already loaded by filter effect
    let cancelled = false
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/admin/audit?${buildQuery()}`)
      if (res.ok && !cancelled) {
        const { entries: data, total: t } = await res.json()
        setEntries(data ?? [])
        setTotal(t ?? 0)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ export: 'csv', limit: '5000' })
      if (search)       params.set('search',  search)
      if (actionFilter) params.set('action',  actionFilter)
      if (dateFrom)     params.set('from',    dateFrom)
      if (dateTo)       params.set('to',      dateTo)
      const res = await fetch(`/api/admin/audit?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  function handleClearFilters() {
    setSearch('')
    setActionFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = search || actionFilter || dateFrom || dateTo

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">Audit Log</h1>
          <p className="text-ink-black/50 text-sm mt-1">
            Every admin action is recorded here for accountability and security review.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="h-9 px-4 rounded-xl bg-teal-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          {exporting ? (
            <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12v6m0 0l-3-3m3 3l3-3M12 3v9" />
            </svg>
          )}
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-black/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search actor, entity, details…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 h-9 rounded-xl border border-steel-grey text-sm text-ink-black placeholder:text-ink-black/30 focus:outline-none focus:border-teal-green bg-white"
            />
          </div>

          {/* Action filter */}
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="h-9 px-3 rounded-xl border border-steel-grey text-sm text-ink-black focus:outline-none focus:border-teal-green bg-white"
          >
            <option value="">All actions</option>
            {ALL_ACTIONS.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-9 px-3 rounded-xl border border-steel-grey text-sm text-ink-black focus:outline-none focus:border-teal-green bg-white"
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-9 px-3 rounded-xl border border-steel-grey text-sm text-ink-black focus:outline-none focus:border-teal-green bg-white"
          />
        </div>

        {hasFilters && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-ink-black/50">{total} matching entries</span>
            <button
              onClick={handleClearFilters}
              className="text-xs text-danger font-semibold hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-steel-grey">
                {['When', 'Actor', 'Role', 'Action', 'Entity', 'IP', 'Details'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-ink-black/40 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-black/40 text-sm">Loading…</td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="text-ink-black/50 text-sm">No audit entries found.</p>
                    {hasFilters && (
                      <p className="text-ink-black/30 text-xs mt-1">
                        Try adjusting your filters.
                      </p>
                    )}
                  </td>
                </tr>
              ) : entries.map((e, i) => {
                const style = ACTION_LABELS[e.action]
                return (
                  <tr key={e.id} className={`border-b border-steel-grey/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-cloud-grey/30'}`}>
                    <td className="px-4 py-3 text-xs text-ink-black/50 whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-black">
                      {e.actor?.full_name ?? e.actor?.email ?? 'System'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-semibold text-ink-black/50 uppercase tracking-wide">
                        {e.actor_role ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                        style?.color ?? 'bg-steel-grey/20 text-ink-black/60'
                      }`}>
                        {style?.label ?? e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-black/50">
                      {e.entity_type ? (
                        <span>
                          <span className="font-semibold">{e.entity_type}</span>
                          {e.entity_id && (
                            <span className="ml-1 text-ink-black/30 font-mono text-[10px]">
                              {e.entity_id.slice(0, 8)}…
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-black/40 font-mono">
                      {e.ip_address ?? '—'}
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
