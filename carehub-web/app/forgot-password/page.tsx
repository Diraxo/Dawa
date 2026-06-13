'use client'

import { Suspense, useState } from 'react'
import { useSignIn } from '@clerk/nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthCard } from '@/components/ui/AuthCard'

function ForgotPasswordContent() {
  const { isLoaded, signIn, setActive } = useSignIn()
  const router = useRouter()
  const params = useSearchParams()
  const step = params.get('step') ?? 'email'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    if (!isLoaded) return
    setLoading(true)
    setError('')
    try {
      await signIn!.create({ strategy: 'reset_password_email_code', identifier: email })
      router.push(`/verify?type=forgot&email=${encodeURIComponent(email)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email not found')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!isLoaded) return
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError('')
    try {
      const result = await signIn!.resetPassword({ password })
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId })
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'reset') {
    return (
      <AuthCard title="New Password" subtitle="Choose a strong, secure password">
        <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New password (min. 8 chars)"
            required
            className="w-full h-[52px] px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
          />
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            required
            className="w-full h-[52px] px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
          />
          {error && <p className="text-danger text-xs font-medium">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? 'Resetting…' : 'Reset Password →'}
          </button>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Forgot Password?" subtitle="Enter your email to receive a reset code">
      <form onSubmit={handleSendCode} className="flex flex-col gap-4">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-black/40">✉️</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Your email address"
            required
            className="w-full h-[52px] pl-11 pr-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
          />
        </div>
        {error && <p className="text-danger text-xs font-medium">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
          {loading ? 'Sending…' : 'Send Reset Code →'}
        </button>
      </form>
      <p className="text-center text-sm text-ink-black/60 mt-5">
        <Link href="/sign-in" className="text-teal-green font-semibold hover:underline">← Back to Sign In</Link>
      </p>
    </AuthCard>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  )
}
