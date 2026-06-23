'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const ADMIN_MAX_ATTEMPTS = 3
const LOCK_DURATION_MS = 60 * 60 * 1000 // 60 minutes

interface LockState {
  lockedUntil: number | null
  count: number
  firstAttempt: number
}

// Module-level state (server component would use Redis; this is client-side guard)
let lockState: LockState = { lockedUntil: null, count: 0, firstAttempt: 0 }

export default function AdminLoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [lockCountdown, setLockCountdown] = useState(0)

  // Honeypot — bots fill hidden fields; humans don't
  const honeypotRef = useRef<HTMLInputElement>(null)
  const formStartedAt = useRef(Date.now())

  useEffect(() => {
    formStartedAt.current = Date.now()
  }, [])

  // Countdown timer
  useEffect(() => {
    if (lockCountdown <= 0) return
    const id = setInterval(() => setLockCountdown((s) => s - 1), 1000)
    return () => clearInterval(id)
  }, [lockCountdown])

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const isLocked = lockCountdown > 0

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Bot check: honeypot filled
    if (honeypotRef.current?.value) return

    // Bot check: form submitted too quickly (< 2 seconds)
    if (Date.now() - formStartedAt.current < 2000) {
      setError('Something went wrong. Please try again.')
      return
    }

    if (isLocked) return

    const now = Date.now()

    // Client-side lockout check
    if (lockState.lockedUntil && now < lockState.lockedUntil) {
      const secondsLeft = Math.ceil((lockState.lockedUntil - now) / 1000)
      setLockCountdown(secondsLeft)
      setError(`Too many failed attempts. Try again in ${fmt(secondsLeft)}.`)
      return
    }

    setLoading(true)
    setError('')

    // Artificial delay to prevent timing attacks
    await new Promise((r) => setTimeout(r, 500))

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        lockState = { lockedUntil: null, count: 0, firstAttempt: 0 }
        router.replace('/admin/dashboard')
        return
      }

      // Record failure
      if (lockState.count === 0) lockState.firstAttempt = now
      lockState.count++

      if (lockState.count >= ADMIN_MAX_ATTEMPTS) {
        lockState.lockedUntil = now + LOCK_DURATION_MS
        const secondsLeft = Math.ceil(LOCK_DURATION_MS / 1000)
        setLockCountdown(secondsLeft)
        setError('Too many failed attempts. Your access is temporarily suspended.')
      } else {
        setError('Invalid email or password.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F5F7FA] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#111827] font-[Montserrat]">Admin Login</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            Admin access only. Unauthorized access is monitored and reported.
          </p>
        </div>

        {/* Honeypot — hidden from real users */}
        <input
          ref={honeypotRef}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ display: 'none' }}
        />

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLocked || loading}
              className="w-full border border-[#D4D9E1] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#2962FF] disabled:opacity-50"
              placeholder="admin@dawa.app"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLocked || loading}
              className="w-full border border-[#D4D9E1] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#2962FF] disabled:opacity-50"
              placeholder="Enter password"
            />
          </div>

          {/* Error message */}
          {error && !isLocked && (
            <p className="text-sm text-[#D32F2F] text-center">{error}</p>
          )}

          {/* Lockout card */}
          {isLocked && (
            <div className="flex items-start gap-3 bg-[#FFF5F5] border border-[#FCA5A5] rounded-xl p-3">
              <span className="text-[#D32F2F] mt-0.5">&#128274;</span>
              <div>
                <p className="text-sm font-semibold text-[#D32F2F]">Access suspended</p>
                <p className="text-sm text-[#374151] mt-0.5">
                  Try again in{' '}
                  <span className="font-bold text-[#D32F2F]">{fmt(lockCountdown)}</span>
                </p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full h-[52px] rounded-2xl text-white font-bold text-base disabled:opacity-50 transition"
            style={{ background: isLocked ? '#D4D9E1' : 'linear-gradient(to right, #2962FF, #00BFA5)' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  )
}
