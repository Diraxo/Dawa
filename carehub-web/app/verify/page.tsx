'use client'

import { Suspense, useState, useRef, useEffect } from 'react'
import { useSignUp, useSignIn } from '@clerk/nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthCard } from '@/components/ui/AuthCard'
import { otpLimiter } from '@/lib/otpLimiter'

function VerifyContent() {
  const { isLoaded: suLoaded, signUp, setActive: suSetActive } = useSignUp()
  const { isLoaded: siLoaded, signIn } = useSignIn()
  const router = useRouter()
  const params = useSearchParams()
  const type = params.get('type') ?? 'signup'
  const email = params.get('email') ?? ''

  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendTimer, setResendTimer] = useState(30)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (resendTimer <= 0) return
    const t = setTimeout(() => setResendTimer(v => v - 1), 1000)
    return () => clearTimeout(t)
  }, [resendTimer])

  function handleDigit(i: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...code]
    next[i] = val
    setCode(next)
    setError('')
    if (val && i < 5) {
      inputs.current[i + 1]?.focus()
    } else if (val && i === 5) {
      const full = next.join('')
      if (full.length === 6) handleVerify(full)
    }
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputs.current[i - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('')
    const next = [...code]
    digits.forEach((d, i) => { next[i] = d })
    setCode(next)
    setError('')
    inputs.current[Math.min(digits.length, 5)]?.focus()
    const full = next.join('')
    if (full.length === 6) handleVerify(full)
  }

  async function handleVerify(codeOverride?: string) {
    const otp = codeOverride ?? code.join('')
    if (otp.length < 6) return
    setLoading(true)
    setError('')
    try {
      if (type === 'signup' && suLoaded) {
        const result = await signUp!.attemptEmailAddressVerification({ code: otp })
        if (result.status === 'complete') {
          await suSetActive!({ session: result.createdSessionId })
          router.push('/role')
        }
      } else if (type === 'forgot' && siLoaded) {
        const result = await signIn!.attemptFirstFactor({ strategy: 'reset_password_email_code', code: otp })
        if (result.status === 'needs_new_password') {
          router.push(`/reset-password?email=${encodeURIComponent(email)}`)
        }
      }
    } catch (err: unknown) {
      const anyErr = err as any
      const errCode: string = anyErr?.errors?.[0]?.code ?? ''
      const errMsg: string =
        anyErr?.errors?.[0]?.longMessage ?? anyErr?.errors?.[0]?.message ?? ''
      const lower = errMsg.toLowerCase()
      setError(
        lower.includes('incorrect') || lower.includes('invalid')
          ? 'Incorrect code. Please try again.'
          : lower.includes('expired')
          ? 'Code has expired. Tap "Resend code" below.'
          : errCode === 'resource_not_found' || lower.includes('no sign in was found')
          ? 'This session has expired or is no longer valid. Please start over.'
          : (errMsg || 'Invalid code. Please try again.')
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendTimer > 0) return
    const check = await otpLimiter.canRequest(email)
    if (!check.allowed) {
      if (check.waitSeconds) setResendTimer(check.waitSeconds)
      setError(check.message ?? 'Please wait before requesting another code.')
      return
    }
    try {
      if (type === 'signup' && suLoaded) {
        await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' })
      } else if (type === 'forgot' && siLoaded) {
        await signIn!.create({ strategy: 'reset_password_email_code', identifier: email })
      }
      await otpLimiter.recordRequest(email)
      setResendTimer(30)
      setCode(['', '', '', '', '', ''])
    } catch (err: unknown) {
      const anyErr = err as any
      setError(anyErr?.errors?.[0]?.message ?? 'Failed to resend. Please try again.')
    }
  }

  return (
    <AuthCard
      title="Verify Code"
      subtitle="We sent a 6-digit code to"
    >
      <p className="text-center text-sm font-bold text-ink-black mb-6 -mt-4">{email}</p>

      {/* OTP inputs */}
      <div className="flex gap-2 justify-center mb-4" onPaste={handlePaste}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={el => { inputs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            autoFocus={i === 0}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            className="w-12 h-14 rounded-2xl border-2 border-steel-grey text-center font-montserrat font-bold text-xl text-ink-black bg-cloud-grey focus:outline-none focus:border-int-blue transition-colors"
          />
        ))}
      </div>

      <p className="text-center text-xs text-ink-black/50 mb-2">
        {resendTimer > 0 ? (
          <>Resend code in <span className="font-bold text-care-blue">
            {String(Math.floor(resendTimer / 60)).padStart(2, '0')}:{String(resendTimer % 60).padStart(2, '0')}
          </span></>
        ) : (
          <button onClick={handleResend} className="text-teal-green font-semibold hover:underline">
            Resend code
          </button>
        )}
      </p>

      {/* Info card */}
      <div className="flex items-start gap-2.5 bg-blue-50 rounded-2xl p-3.5 mb-5">
        <svg className="text-int-blue mt-0.5 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <p className="text-xs text-int-blue/80 leading-relaxed">
          Check your spam folder if you didn&apos;t receive the email.
        </p>
      </div>

      {error && <p className="text-danger text-xs font-medium mb-3 text-center">{error}</p>}

      <button
        onClick={() => handleVerify()}
        disabled={loading || code.join('').length < 6}
        className="btn-primary w-full disabled:opacity-50"
      >
        {loading ? 'Verifying…' : 'Continue →'}
      </button>

      <p className="text-center text-sm text-ink-black/60 mt-5">
        <Link href="/sign-up" className="text-teal-green font-semibold hover:underline">
          ← Back
        </Link>
      </p>
    </AuthCard>
  )
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  )
}
