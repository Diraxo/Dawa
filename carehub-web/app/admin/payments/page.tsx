'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, stripDrPrefix } from '@/lib/utils'

type Tab = 'revenue' | 'withdrawals' | 'commission'

interface Transaction {
  id: string
  patient_amount: number
  doctor_amount: number
  platform_amount: number
  payment_status: string
  type: string
  status: string
  created_at: string
  patient: { full_name: string } | null
  doctor_profile: { user: { full_name: string } | null } | null
}

interface Withdrawal {
  id: string
  amount: number
  status: string
  bank_details: string | null
  requested_at: string
  processed_at: string | null
  doctor: { user: { full_name: string } | null } | null
}

const PAGE_SIZE = 20

export default function AdminPaymentsPage() {
  const [tab, setTab] = useState<Tab>('revenue')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [commission, setCommission] = useState(20)
  const [loadingTx, setLoadingTx] = useState(true)
  const [loadingWd, setLoadingWd] = useState(true)
  const [loadingCommission, setLoadingCommission] = useState(true)
  const [processingWd, setProcessingWd] = useState<string | null>(null)
  const [savingCommission, setSavingCommission] = useState(false)
  const [commissionSaved, setCommissionSaved] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Revenue filters & pagination
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [txPage, setTxPage] = useState(0)
  const [txTotal, setTxTotal] = useState(0)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadTransactions = useCallback(async (page = 0, from = '', to = '') => {
    setLoadingTx(true)
    let query = supabase
      .from('consultations')
      .select('id, patient_amount, doctor_amount, platform_amount, payment_status, type, status, created_at, patient:users!patient_id(full_name), doctor_profile:doctor_profiles(user:users(full_name))', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to) {
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      query = query.lte('created_at', end.toISOString())
    }

    const { data, count } = await query
    setTransactions((data ?? []) as unknown as Transaction[])
    setTxTotal(count ?? 0)
    setLoadingTx(false)
  }, [])

  useEffect(() => {
    loadTransactions(0, dateFrom, dateTo)
    setTxPage(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  useEffect(() => {
    supabase
      .from('withdrawals')
      .select('id, amount, status, bank_details, requested_at, processed_at, doctor:doctor_profiles(user:users(full_name))')
      .order('requested_at', { ascending: false })
      .then(({ data }) => {
        setWithdrawals((data ?? []) as unknown as Withdrawal[])
        setLoadingWd(false)
      })

    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'commission_rate')
      .single()
      .then(({ data }) => {
        if (data?.value !== undefined && data?.value !== null) {
          setCommission(Number(data.value))
        }
        setLoadingCommission(false)
      })
  }, [])

  async function handleWithdrawal(id: string, action: 'approve' | 'reject' | 'paid') {
    setProcessingWd(id)
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`Failed: ${data.error ?? res.statusText}`, 'error')
        return
      }
      setWithdrawals(prev => prev.map(w =>
        w.id === id ? { ...w, status: data.status, processed_at: new Date().toISOString() } : w
      ))
      const messages: Record<string, string> = {
        approve: 'Withdrawal approved — doctor notified.',
        reject: 'Withdrawal rejected — doctor notified.',
        paid: 'Marked as paid — doctor notified.',
      }
      showToast(messages[action], 'success')
    } finally {
      setProcessingWd(null)
    }
  }

  async function saveCommissionRate() {
    setSavingCommission(true)
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'commission_rate', value: commission, updated_at: new Date().toISOString() })
    if (error) {
      showToast(`Failed to save: ${error.message}`, 'error')
      setSavingCommission(false)
      return
    }
    setSavingCommission(false)
    setCommissionSaved(true)
    setTimeout(() => setCommissionSaved(false), 3000)
  }

  function handlePageChange(newPage: number) {
    setTxPage(newPage)
    loadTransactions(newPage, dateFrom, dateTo)
  }

  const totalRevenue = transactions.reduce((s, t) => s + (t.patient_amount ?? 0), 0)
  const totalPlatform = transactions.reduce((s, t) => s + (t.platform_amount ?? 0), 0)
  const totalDoctor = transactions.reduce((s, t) => s + (t.doctor_amount ?? 0), 0)
  const totalPages = Math.ceil(txTotal / PAGE_SIZE)

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'revenue', label: 'Revenue', icon: '💰' },
    { key: 'withdrawals', label: 'Withdrawal Requests', icon: '🏦' },
    { key: 'commission', label: 'Commission Settings', icon: '⚙️' },
  ]

  return (
    <div className="p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold font-montserrat transition-all ${
          toast.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="mb-6">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Payments</h1>
        <p className="text-ink-black/50 text-sm mt-1">Revenue, withdrawals, and commission settings</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Shown Revenue', value: `ETB ${totalRevenue.toLocaleString()}`, icon: '💰', color: 'from-int-blue to-teal-green' },
          { label: 'Platform Earnings', value: `ETB ${totalPlatform.toLocaleString()}`, icon: '📊', color: 'from-care-blue to-int-blue' },
          { label: 'Paid to Doctors', value: `ETB ${totalDoctor.toLocaleString()}`, icon: '👨‍⚕️', color: 'from-teal-green to-emerald-400' },
        ].map(c => (
          <div key={c.label} className="card p-5">
            <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${c.color} flex items-center justify-center text-lg mb-3`}>
              {c.icon}
            </div>
            <p className="font-montserrat font-black text-2xl text-ink-black mb-0.5">
              {loadingTx ? '—' : c.value}
            </p>
            <p className="text-ink-black/50 text-xs">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-cloud-grey rounded-2xl p-1 mb-6 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === t.key ? 'bg-white shadow-card text-ink-black' : 'text-ink-black/50 hover:text-ink-black'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Revenue tab */}
      {tab === 'revenue' && (
        <>
          {/* Date filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-ink-black/50 uppercase tracking-wider">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-ink-black/50 uppercase tracking-wider">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 px-3 rounded-xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black focus:outline-none focus:border-int-blue"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-xs text-ink-black/50 hover:text-ink-black underline"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-ink-black/40 ml-auto">{txTotal} total records</span>
          </div>

          <div className="card overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-cloud-grey">
                <tr>
                  {['Patient', 'Doctor', 'Type', 'Status', 'Total', 'Platform', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-montserrat font-bold text-xs text-ink-black/60 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-grey">
                {loadingTx ? (
                  <tr><td colSpan={7} className="text-center py-8 text-ink-black/40">Loading…</td></tr>
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-ink-black/40">No transactions found.</td></tr>
                ) : transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-cloud-grey/50">
                    <td className="px-4 py-3 font-medium text-ink-black">{tx.patient?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-black/70">Dr. {stripDrPrefix(tx.doctor_profile?.user?.full_name ?? '—')}</td>
                    <td className="px-4 py-3">
                      <span className="capitalize">{tx.type === 'chat' ? '💬' : tx.type === 'phone' ? '📞' : '🎥'} {tx.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        tx.status === 'completed' ? 'bg-success/10 text-success'
                        : tx.status === 'active' ? 'bg-int-blue/10 text-int-blue'
                        : tx.status === 'cancelled' ? 'bg-danger/10 text-danger'
                        : 'bg-warning/10 text-warning'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-ink-black">ETB {tx.patient_amount}</td>
                    <td className="px-4 py-3 text-teal-green font-semibold">ETB {tx.platform_amount}</td>
                    <td className="px-4 py-3 text-ink-black/50">{formatDate(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => handlePageChange(txPage - 1)}
                disabled={txPage === 0}
                className="h-9 px-4 rounded-xl border border-steel-grey text-sm font-semibold text-ink-black/60 hover:border-int-blue disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="text-sm text-ink-black/50 font-medium">
                Page {txPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(txPage + 1)}
                disabled={txPage >= totalPages - 1}
                className="h-9 px-4 rounded-xl border border-steel-grey text-sm font-semibold text-ink-black/60 hover:border-int-blue disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Withdrawals tab */}
      {tab === 'withdrawals' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud-grey">
              <tr>
                {['Doctor', 'Amount', 'Bank Details', 'Requested', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-montserrat font-bold text-xs text-ink-black/60 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-grey">
              {loadingWd ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink-black/40">Loading…</td></tr>
              ) : withdrawals.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink-black/40">No withdrawal requests</td></tr>
              ) : withdrawals.map(wd => (
                <tr key={wd.id} className="hover:bg-cloud-grey/50">
                  <td className="px-4 py-3 font-medium text-ink-black">Dr. {stripDrPrefix(wd.doctor?.user?.full_name ?? '—')}</td>
                  <td className="px-4 py-3 font-bold text-ink-black">ETB {wd.amount}</td>
                  <td className="px-4 py-3 text-ink-black/60 text-xs max-w-[150px] truncate">{wd.bank_details ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-black/50">{formatDate(wd.requested_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      wd.status === 'paid' ? 'bg-teal-green/15 text-teal-green'
                      : wd.status === 'approved' ? 'bg-success/10 text-success'
                      : wd.status === 'rejected' ? 'bg-danger/10 text-danger'
                      : 'bg-warning/10 text-warning'
                    }`}>
                      {wd.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {wd.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleWithdrawal(wd.id, 'approve')}
                          disabled={processingWd === wd.id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-success/10 text-success border border-success/20 font-semibold hover:bg-success/20 disabled:opacity-50"
                        >
                          ✅ Approve
                        </button>
                        <button
                          onClick={() => handleWithdrawal(wd.id, 'reject')}
                          disabled={processingWd === wd.id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-danger/10 text-danger border border-danger/20 font-semibold hover:bg-danger/20 disabled:opacity-50"
                        >
                          ❌ Reject
                        </button>
                      </div>
                    )}
                    {wd.status === 'approved' && (
                      <button
                        onClick={() => handleWithdrawal(wd.id, 'paid')}
                        disabled={processingWd === wd.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-teal-green/10 text-teal-green border border-teal-green/20 font-semibold hover:bg-teal-green/20 disabled:opacity-50"
                      >
                        💸 Mark as Paid
                      </button>
                    )}
                    {(wd.status === 'rejected' || wd.status === 'paid') && (
                      <span className="text-xs text-ink-black/40">
                        {wd.processed_at ? formatDate(wd.processed_at) : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Commission tab */}
      {tab === 'commission' && (
        <div className="card p-6 max-w-md">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-1">Platform Commission Rate</h2>
          <p className="text-ink-black/50 text-sm mb-6">Percentage of each consultation fee kept by Dawa</p>

          {loadingCommission ? (
            <div className="text-ink-black/40 text-sm py-8 text-center">Loading…</div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-6">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={commission}
                  onChange={e => setCommission(Number(e.target.value))}
                  className="w-24 h-12 rounded-2xl border border-steel-grey bg-cloud-grey px-4 text-2xl font-black text-ink-black text-center focus:outline-none focus:border-int-blue"
                />
                <span className="text-2xl font-black text-ink-black/60">%</span>
              </div>

              <div className="bg-cloud-grey rounded-2xl p-4 mb-6 text-sm">
                <p className="font-semibold text-ink-black mb-1">Example calculation</p>
                <p className="text-ink-black/60">
                  Consultation fee: ETB 200<br />
                  Platform keeps: ETB {Math.round(200 * commission / 100)}<br />
                  Doctor receives: ETB {200 - Math.round(200 * commission / 100)}
                </p>
              </div>

              <button
                onClick={saveCommissionRate}
                className="btn-primary w-full"
                disabled={savingCommission}
              >
                {savingCommission ? 'Saving…' : commissionSaved ? '✅ Saved!' : 'Save Commission Rate'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
