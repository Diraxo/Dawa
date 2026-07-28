'use client'

import { Suspense, useState } from 'react'
import { useSignIn } from '@clerk/nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { AuthCard } from '@/components/ui/AuthCard'

function ResetPasswordContent() {
  const { isLoaded, signIn, setActive } = useSignIn()
  const router = useRouter()
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)

  const isFormReady = password.length >= 8 && password === confirmPassword

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isLoaded || loading) return

    let valid = true
    setPasswordError('')
    setConfirmError('')
    setGlobalError('')

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      valid = false
    }
    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.')
      valid = false
    }
    if (!valid) return

    setLoading(true)
    try {
      const result = await signIn!.resetPassword({ password })
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId! })
        // SignInResource doesn't carry the Clerk user id — let /dashboard
        // resolve role-based routing once the session is active.
        router.push('/dashboard')
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const rawMsg: string = err?.errors?.[0]?.message ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? rawMsg
      if (code === 'resource_not_found' || rawMsg.toLowerCase().includes('no sign in was found')) {
        setGlobalError('This reset session has expired or is no longer valid. Please request a new reset code.')
      } else if (code?.includes('password')) {
        setPasswordError(msg || 'Please choose a stronger password.')
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="New Password"
      subtitle="Create a strong new password for your account"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* Password */}
        <div>
          <div className="relative">
            <Lock size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError('') }}
              placeholder="New password (min. 8 characters)"
              autoFocus
              className={`w-full h-[52px] pl-7 pr-10 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${passwordError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-black/40 hover:text-ink-black/70"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {passwordError && <p className="text-danger text-xs mt-1.5">{passwordError}</p>}
        </div>

        {/* Confirm Password */}
        <div>
          <div className="relative">
            <Lock size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setConfirmError('') }}
              placeholder="Confirm new password"
              className={`w-full h-[52px] pl-7 pr-10 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${confirmError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(p => !p)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-black/40 hover:text-ink-black/70"
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {confirmError && <p className="text-danger text-xs mt-1.5">{confirmError}</p>}
        </div>

        {globalError && <p className="text-danger text-xs font-medium">{globalError}</p>}

        <button
          type="submit"
          disabled={!isFormReady || loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Resetting…' : 'Reset Password →'}
        </button>
      </form>

      <p className="text-center text-sm text-ink-black/60 mt-6">
        <Link href="/sign-in" className="text-teal-green font-semibold hover:underline">
          ← Back to Sign In
        </Link>
      </p>
    </AuthCard>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  )
}
