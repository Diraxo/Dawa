'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth, useSignIn, useSignUp } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
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

export default function SignInPage() {
  const { isSignedIn } = useAuth()
  const { isLoaded, signIn, setActive } = useSignIn()
  const { isLoaded: suLoaded, signUp } = useSignUp()
  const router = useRouter()
  const intendingSignInRef = useRef(false)

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [facebookLoading, setFacebookLoading] = useState(false)

  const oauthLoading = googleLoading || facebookLoading
  const isFormReady = isValidEmail(email) && password.length > 0

  useEffect(() => {
    if (isSignedIn && !intendingSignInRef.current) router.replace('/dashboard')
  }, [isSignedIn, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isLoaded || !isFormReady || loading) return
    const normalizedEmail = email.trim().toLowerCase()
    setEmailError('')
    setPasswordError('')
    setGlobalError('')
    setLoading(true)
    intendingSignInRef.current = true
    try {
      const result = await signIn!.create({
        identifier: normalizedEmail,
        password,
      })
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId })
        router.push('/dashboard')
      } else {
        intendingSignInRef.current = false
      }
    } catch (err: any) {
      intendingSignInRef.current = false
      const code: string = err?.errors?.[0]?.code ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? ''
      if (code === 'form_identifier_not_found') {
        setGlobalError('No account found with this email. Please sign up first.')
      } else if (code === 'form_password_incorrect') {
        setPasswordError('Incorrect password. Please try again.')
      } else if (code === 'too_many_requests') {
        setGlobalError('Too many failed attempts. Please try again later.')
      } else if (code === 'session_exists') {
        // Already signed in — redirect to dashboard instead of showing an error
        router.replace('/dashboard')
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = useCallback(async () => {
    if (!isLoaded || oauthLoading) return
    setGoogleLoading(true)
    setGlobalError('')
    try {
      const attempt = await signIn!.create({
        strategy: 'oauth_google',
        redirectUrl: `${window.location.origin}/sso-callback`,
        actionCompleteRedirectUrl: `${window.location.origin}/dashboard`,
      })
      const externalUrl = attempt.firstFactorVerification.externalVerificationRedirectURL
      if (externalUrl) {
        const url = new URL(externalUrl.toString())
        url.searchParams.set('prompt', 'select_account')
        window.location.href = url.toString()
      }
    } catch (err: any) {
      setGoogleLoading(false)
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        router.replace('/dashboard')
      } else if (code !== 'oauth_access_denied') {
        setGlobalError(err?.errors?.[0]?.message ?? 'Google sign-in failed. Please try again.')
      }
    }
  }, [isLoaded, oauthLoading, signIn, router])

  const handleFacebook = useCallback(async () => {
    if (!isLoaded || oauthLoading) return
    setFacebookLoading(true)
    setGlobalError('')
    try {
      await signIn!.authenticateWithRedirect({
        strategy: 'oauth_facebook',
        redirectUrl: `${window.location.origin}/sso-callback`,
        redirectUrlComplete: `${window.location.origin}/dashboard`,
      })
    } catch (err: any) {
      setFacebookLoading(false)
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        router.replace('/dashboard')
      } else if (code !== 'oauth_access_denied') {
        setGlobalError(err?.errors?.[0]?.message ?? 'Facebook sign-in failed. Please try again.')
      }
    }
  }, [isLoaded, oauthLoading, signIn, router])

  return (
    <AuthCard title="Welcome Back" subtitle="Sign in to your account">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-label="Sign in form" noValidate>

        {/* Email */}
        <div>
          <label htmlFor="signin-email" className="sr-only">Email address</label>
          <div className="relative">
            <Mail size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" aria-hidden="true" />
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value.toLowerCase()); setEmailError(''); setGlobalError('') }}
              placeholder="Type your email"
              autoFocus
              autoComplete="email"
              aria-required="true"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'signin-email-error' : undefined}
              className={`w-full h-[52px] pl-7 pr-4 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${emailError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
          </div>
          {emailError && <p id="signin-email-error" role="alert" className="text-danger text-xs mt-1.5">{emailError}</p>}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="signin-password" className="sr-only">Password</label>
          <div className="relative">
            <Lock size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-black/40" aria-hidden="true" />
            <input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError(''); setGlobalError('') }}
              placeholder="Password"
              autoComplete="current-password"
              aria-required="true"
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? 'signin-password-error' : undefined}
              className={`w-full h-[52px] pl-7 pr-10 bg-transparent border-0 border-b-2 font-montserrat text-sm text-ink-black placeholder:text-steel-grey focus:outline-none transition-colors ${passwordError ? 'border-danger' : 'border-steel-grey focus:border-int-blue'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-black/40 hover:text-ink-black/70"
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {passwordError && <p id="signin-password-error" role="alert" className="text-danger text-xs mt-1.5">{passwordError}</p>}
        </div>

        {/* Forgot password */}
        <div className="flex justify-end -mt-2">
          <Link href="/forgot-password" className="text-int-blue text-xs font-medium hover:underline">
            Forgot password?
          </Link>
        </div>

        {globalError && <p role="alert" aria-live="polite" className="text-danger text-xs font-medium">{globalError}</p>}

        <button
          type="submit"
          disabled={loading || !isFormReady}
          aria-disabled={loading || !isFormReady}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign In →'}
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
          disabled={oauthLoading}
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
        <button
          onClick={handleFacebook}
          disabled={oauthLoading}
          className="btn-outline w-full flex items-center gap-3 justify-center disabled:opacity-60"
        >
          {facebookLoading ? (
            <Spinner />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M18 9a9 9 0 10-10.406 8.891V11.6H5.309V9h2.285V7.023c0-2.256 1.343-3.503 3.4-3.503.984 0 2.014.176 2.014.176V5.9h-1.135c-1.117 0-1.466.694-1.466 1.406V9h2.494l-.399 2.6h-2.095v6.291A9 9 0 0018 9z" fill="#1877F2"/>
            </svg>
          )}
          Continue with Facebook
        </button>
      </div>

      <p className="text-center text-sm text-ink-black/60 mt-6">
        Don&apos;t have an account?{' '}
        <Link href="/sign-up" className="text-teal-green font-semibold hover:underline">
          Sign Up for Free
        </Link>
      </p>
    </AuthCard>
  )
}
