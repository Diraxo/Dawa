'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth, useSignUp } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, Eye, EyeOff, User } from 'lucide-react'
import { AuthCard } from '@/components/ui/AuthCard'

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function SignUpPage() {
  const { isSignedIn } = useAuth()
  const { isLoaded: suLoaded, signUp } = useSignUp()
  const router = useRouter()

  useEffect(() => {
    if (isSignedIn) router.replace('/dashboard')
  }, [isSignedIn, router])

  const [fullName, setFullName] = useState('')
  const [fullNameError, setFullNameError] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const oauthLoading = googleLoading
  const isFormReady =
    fullName.trim().length > 1 &&
    isValidEmail(email) &&
    password.length >= 8 &&
    password === confirmPassword

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault()
    if (!suLoaded || loading) return
    const normalizedEmail = email.trim().toLowerCase()
    const trimmedName = fullName.trim()
    let valid = true
    setFullNameError('')
    setEmailError('')
    setPasswordError('')
    setConfirmError('')
    setGlobalError('')

    if (!trimmedName || trimmedName.length < 2) {
      setFullNameError('Please enter your full name.')
      valid = false
    }
    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Please enter a valid email address.')
      valid = false
    }
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
      const nameParts = trimmedName.split(/\s+/)
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ') || undefined
      await signUp!.create({
        emailAddress: normalizedEmail,
        password,
        firstName,
        lastName,
      })
      await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' })
      router.push(`/verify?email=${encodeURIComponent(normalizedEmail)}&type=signup`)
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? ''
      if (code === 'form_identifier_exists') {
        setEmailError('An account with this email already exists. Please sign in instead.')
      } else if (code?.includes('password')) {
        setPasswordError(msg || 'Please choose a stronger password (min. 8 characters).')
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = useCallback(async () => {
    if (!suLoaded || oauthLoading) return
    setGoogleLoading(true)
    setGlobalError('')
    try {
      const attempt = await signUp!.create({
        strategy: 'oauth_google',
        redirectUrl: `${window.location.origin}/sso-callback`,
        actionCompleteRedirectUrl: `${window.location.origin}/dashboard`,
      })
      const externalUrl = attempt.verifications.externalAccount.externalVerificationRedirectURL
      if (externalUrl) {
        const url = new URL(externalUrl.toString())
        url.searchParams.set('prompt', 'select_account')
        window.location.href = url.toString()
      }
    } catch (err: any) {
      setGoogleLoading(false)
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code !== 'oauth_access_denied') {
        setGlobalError(err?.errors?.[0]?.message ?? 'Google sign-in failed. Please try again.')
      }
    }
  }, [suLoaded, oauthLoading, signUp])

  return (
    <AuthCard title="Sign Up" subtitle="Create account and access all health services">
      <form onSubmit={handleContinue} className="flex flex-col gap-4">

        {/* Full Name */}
        <div>
          <div className="relative">
            <User size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type="text"
              value={fullName}
              onChange={e => { setFullName(e.target.value); setFullNameError('') }}
              placeholder="Full name"
              autoFocus
              className={`w-full h-[52px] pl-7 pr-4 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${fullNameError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
          </div>
          {fullNameError && <p className="text-danger text-xs mt-1.5">{fullNameError}</p>}
        </div>

        {/* Email */}
        <div>
          <div className="relative">
            <Mail size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setEmailError('') }}
              placeholder="Type your email"
              className={`w-full h-[52px] pl-7 pr-4 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${emailError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
          </div>
          {emailError && <p className="text-danger text-xs mt-1.5">{emailError}</p>}
        </div>

        {/* Password */}
        <div>
          <div className="relative">
            <Lock size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError('') }}
              placeholder="Password (min. 8 characters)"
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
              placeholder="Confirm Password"
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
          disabled={!suLoaded || !isFormReady || loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Creating account…' : 'Continue →'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-steel-grey" />
        <span className="text-ink-black/40 text-xs font-medium">OR</span>
        <div className="flex-1 h-px bg-steel-grey" />
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleGoogle}
          disabled={!suLoaded || oauthLoading}
          className="btn-outline w-full flex items-center gap-3 justify-center disabled:opacity-60"
        >
          {googleLoading ? (
            <Spinner />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          Continue with Google
        </button>
      </div>

      <p className="text-center text-sm text-ink-black/60 mt-6">
        Have an account?{' '}
        <Link href="/sign-in" className="text-teal-green font-semibold hover:underline">Login</Link>
      </p>
    </AuthCard>
  )
}
