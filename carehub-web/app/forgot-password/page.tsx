'use client'

import { useState } from 'react'
import { useSignIn } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { AuthCard } from '@/components/ui/AuthCard'

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

export default function ForgotPasswordPage() {
  const { isLoaded, signIn } = useSignIn()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isLoaded || !isValidEmail(email) || loading) return
    const normalizedEmail = email.trim().toLowerCase()
    setEmailError('')
    setGlobalError('')
    setLoading(true)
    try {
      await signIn!.create({
        strategy: 'reset_password_email_code',
        identifier: normalizedEmail,
      })
      router.push(`/verify?email=${encodeURIComponent(normalizedEmail)}&type=forgot`)
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? ''
      if (code === 'form_identifier_not_found') {
        setEmailError('No account found with this email.')
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Forgot Password?"
      subtitle="Enter your email and we'll send you a reset code"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <div className="relative">
            <Mail size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setEmailError('') }}
              placeholder="Type your email"
              autoFocus
              className={`w-full h-[52px] pl-7 pr-4 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${emailError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
          </div>
          {emailError && <p className="text-danger text-xs mt-1.5">{emailError}</p>}
        </div>

        {globalError && <p className="text-danger text-xs font-medium">{globalError}</p>}

        <button
          type="submit"
          disabled={!isValidEmail(email) || loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Sending code…' : 'Send Reset Code →'}
        </button>
      </form>

      <p className="text-center text-sm text-ink-black/60 mt-6">
        Remember your password?{' '}
        <Link href="/sign-in" className="text-teal-green font-semibold hover:underline">
          Sign In
        </Link>
      </p>
    </AuthCard>
  )
}
