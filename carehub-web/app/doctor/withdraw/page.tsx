'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { Wallet, Clock, CheckCircle, XCircle, ChevronRight } from 'lucide-react'

interface Withdrawal {
  id: string
  amount: number
  status: string
  bank_details: string | null
  requested_at: string
}

const STATUS_STYLES: Record<string, { bg: string; text: string; Icon: typeof Clock }> = {
  pending:   { bg: 'bg-warning/10',    text: 'text-warning',    Icon: Clock },
  approved:  { bg: 'bg-success/10',    text: 'text-success',    Icon: CheckCircle },
  rejected:  { bg: 'bg-danger/10',     text: 'text-danger',     Icon: XCircle },
  processed: { bg: 'bg-int-blue/10',   text: 'text-int-blue',   Icon: CheckCircle },
}

export default function DoctorWithdrawPage() {
  const { user } = useUser()
  const { getToken } = useAuth()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [availableBalance, setAvailableBalance] = useState(0)
  const [history, setHistory] = useState<Withdrawal[]>([])
  const [tab, setTab] = useState<'request' | 'history'>('request')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const [amount, setAmount] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountHolder, setAccountHolder] = useState(user?.fullName ?? '')

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (user) load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function load() {
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)

    const [totalRes, withdrawnRes, historyRes] = await Promise.all([
      client.from('consultations').select('doctor_amount').eq('status', 'completed'),
      client.from('withdrawals').select('amount').in('status', ['pending', 'approved', 'processed']),
      client.from('withdrawals').select('id, amount, status, bank_details, requested_at').order('requested_at', { ascending: false }),
    ])

    const totalEarned = (totalRes.data ?? []).reduce((s, r: any) => s + (Number(r.doctor_amount) || 0), 0)
    const totalWithdrawn = (withdrawnRes.data ?? []).reduce((s, r: any) => s + (Number(r.amount) || 0), 0)
    setAvailableBalance(Math.max(0, totalEarned - totalWithdrawn))
    setHistory((historyRes.data ?? []) as Withdrawal[])
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) { showToast('Please enter a valid amount.', 'error'); return }
    if (numAmount > availableBalance) { showToast(`Maximum withdrawal is ETB ${availableBalance.toLocaleString()}.`, 'error'); return }
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) { showToast('Please fill in all bank details.', 'error'); return }

    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token || !user) throw new Error('Not authenticated')
      const client = getAuthClient(token)

      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!ud) throw new Error('User not found')

      const { error } = await client.from('withdrawals').insert({
        doctor_id:    (ud as any).id,
        amount:       numAmount,
        status:       'pending',
        bank_details: JSON.stringify({ bank_name: bankName.trim(), account_number: accountNumber.trim(), account_holder: accountHolder.trim() }),
        requested_at: new Date().toISOString(),
      })
      if (error) throw error

      showToast('Withdrawal request submitted. Processing takes 1–3 business days.', 'success')
      setAmount('')
      setBankName('')
      setAccountNumber('')
      setTab('history')
      await load()
    } catch (err: any) {
      showToast(err?.message ?? 'Could not submit. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function parseBankDetails(raw: string | null) {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="h-32 shimmer-bg rounded-3xl mb-6" />
        <div className="h-48 shimmer-bg rounded-3xl" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl font-montserrat font-semibold text-sm text-white shadow-lg transition-all ${toast.type === 'success' ? 'bg-success' : 'bg-danger'}`}>
          {toast.message}
        </div>
      )}

      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Withdraw Earnings</h1>
        <p className="text-ink-black/50 text-sm mt-1">Request a transfer of your consultation earnings</p>
      </div>

      {/* Balance card */}
      <div
        className="rounded-3xl p-8 mb-8 text-white flex items-center gap-6"
        style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
      >
        <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Wallet size={32} />
        </div>
        <div>
          <p className="text-white/70 text-sm mb-1">Available Balance</p>
          <p className="font-montserrat font-black text-4xl">ETB {availableBalance.toLocaleString()}</p>
          <p className="text-white/60 text-xs mt-1">After deducting pending withdrawals</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-cloud-grey rounded-2xl mb-8">
        {(['request', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl font-montserrat font-semibold text-sm transition-all capitalize ${tab === t ? 'bg-white text-ink-black shadow-sm' : 'text-ink-black/50'}`}
          >
            {t === 'request' ? 'New Request' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'request' ? (
        <form onSubmit={handleSubmit} className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-6">Withdrawal Details</h2>

          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Amount (ETB)</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`Max ETB ${availableBalance.toLocaleString()}`}
                min={1}
                max={availableBalance}
                className="w-full h-12 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Bank Name</label>
              <input
                type="text"
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="e.g. Commercial Bank of Ethiopia"
                className="w-full h-12 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Account Number</label>
              <input
                type="text"
                value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)}
                placeholder="Your bank account number"
                className="w-full h-12 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">Account Holder Name</label>
              <input
                type="text"
                value={accountHolder}
                onChange={e => setAccountHolder(e.target.value)}
                placeholder="Name on the bank account"
                className="w-full h-12 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
                required
              />
            </div>
          </div>

          <div className="flex items-start gap-3 bg-int-blue/5 border border-int-blue/20 rounded-2xl p-4 mt-6">
            <span className="text-int-blue mt-0.5 flex-shrink-0">ℹ️</span>
            <p className="text-sm text-int-blue/80">Processing takes 1–3 business days. You will receive an email once your funds are transferred.</p>
          </div>

          <button
            type="submit"
            disabled={submitting || availableBalance === 0}
            className="mt-6 w-full h-14 rounded-2xl font-montserrat font-bold text-white text-base disabled:opacity-50 flex items-center justify-center gap-2.5"
            style={{ background: submitting || availableBalance === 0 ? '#9CA3AF' : 'linear-gradient(to right, #2962FF, #00BFA5)' }}
          >
            <Wallet size={18} />
            {submitting ? 'Submitting…' : 'Submit Withdrawal Request'}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {history.length === 0 ? (
            <div className="card p-14 text-center">
              <p className="text-4xl mb-4">🏦</p>
              <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No requests yet</p>
              <p className="text-ink-black/50 text-sm">Your withdrawal history will appear here.</p>
            </div>
          ) : (
            history.map(w => {
              const bank = parseBankDetails(w.bank_details)
              const style = STATUS_STYLES[w.status] ?? STATUS_STYLES.pending
              const Icon = style.Icon
              return (
                <div key={w.id} className="card p-5">
                  <div className="flex items-center gap-4">
                    <div className={`w-11 h-11 rounded-2xl ${style.bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon size={20} className={style.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-montserrat font-bold text-ink-black">ETB {Number(w.amount).toLocaleString()}</p>
                      <p className="text-xs text-ink-black/50 mt-0.5">
                        {new Date(w.requested_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        {bank ? ` · ${bank.bank_name} ···${String(bank.account_number).slice(-4)}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${style.bg} ${style.text}`}>{w.status}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
