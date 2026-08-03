'use client'

import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

export default function UnderReviewPage() {
  const { user } = useUser()
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [showRejectionModal, setShowRejectionModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  async function handleCheckStatus() {
    if (checking) return
    setChecking(true)
    try {
      const { data: profile, error } = await supabase
        .from('doctor_profiles')
        .select('status, rejection_reason, user:users!inner(clerk_id)')
        .eq('users.clerk_id', user?.id ?? '')
        .maybeSingle()

      if (error) throw error

      if (profile?.status === 'approved') {
        router.replace('/doctor')
      } else if (profile?.status === 'rejected') {
        setRejectionReason(
          profile.rejection_reason ?? 'Your application was not approved. Please reapply with valid documents.'
        )
        setShowRejectionModal(true)
      } else {
        alert("Your application is still under review. We'll notify you by email once it's been reviewed.")
      }
    } catch {
      alert('Connection error. Please check your internet connection and try again.')
    } finally {
      setChecking(false)
    }
  }

  const NEXT_STEPS = [
    {
      icon: '🔍',
      bg: '#EFF6FF',
      text: 'Our admin team reviews your license and uploaded documents',
    },
    {
      icon: '✉️',
      bg: '#F0FDFB',
      text: 'You receive an email notification with the review decision',
    },
    {
      icon: '🟢',
      bg: '#F0FDF4',
      text: 'Once approved, your account is activated and you can start accepting consultations',
    },
  ]

  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <LogoMark size={40} variant="dark" />
          <span className="font-montserrat font-bold text-2xl text-ink-black">
            DA<span className="text-teal-green">WA</span>
          </span>
        </Link>

        {/* Hourglass illustration */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="w-36 h-36 rounded-full flex items-center justify-center shadow-blue" style={{ background: 'linear-gradient(135deg, #EFF6FF 0%, #F0FDFB 100%)' }}>
              <span className="text-7xl select-none">⏳</span>
            </div>
            {/* Teal checkmark badge */}
            <div className="absolute bottom-1 right-1 w-9 h-9 rounded-full bg-gradient-interactive flex items-center justify-center shadow-teal">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Main card */}
        <div className="bg-white rounded-2xl shadow-card p-8 text-center">
          <h1 className="font-montserrat font-bold text-2xl text-ink-black mb-3">
            Application Submitted
          </h1>
          <p className="text-sm text-ink-black/60 font-montserrat leading-relaxed mb-6">
            Your application is under review. Our team will verify your credentials within{' '}
            <strong className="text-ink-black">24–48 hours</strong> and notify you by email.
          </p>

          <div className="w-full h-px bg-cloud-grey my-6" />

          <h2 className="font-montserrat font-semibold text-base text-ink-black mb-4 text-left">
            What happens next?
          </h2>

          <div className="flex flex-col gap-3 text-left">
            {NEXT_STEPS.map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: s.bg }}
                >
                  {s.icon}
                </div>
                <p className="text-sm text-ink-black/70 font-montserrat leading-relaxed mt-1.5">
                  {s.text}
                </p>
              </div>
            ))}
          </div>

          <div className="w-full h-px bg-cloud-grey my-6" />

          {/* Support link */}
          <a
            href="mailto:support@dawa.app?subject=Doctor%20Application%20Help"
            className="flex items-center justify-center gap-2 text-sm text-ink-black/60 hover:text-teal-green transition-colors font-montserrat"
          >
            <svg className="w-4 h-4 text-teal-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Need help?{' '}
            <span className="text-teal-green font-semibold">Contact Support</span>
          </a>
        </div>

        {/* Go Home button */}
        <button
          type="button"
          onClick={() => router.replace('/doctor')}
          className="w-full mt-4 h-14 rounded-2xl bg-gradient-interactive text-white font-semibold text-sm font-montserrat hover:opacity-90 transition-opacity"
        >
          Go Home
        </button>

        {/* Check status button */}
        <button
          type="button"
          onClick={handleCheckStatus}
          disabled={checking}
          className="w-full mt-3 h-14 border-2 border-steel-grey rounded-2xl bg-white flex items-center justify-center gap-2.5 text-care-blue font-semibold text-sm font-montserrat hover:border-care-blue transition-colors disabled:opacity-50"
        >
          {checking ? (
            <span className="text-care-blue font-montserrat">Checking…</span>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Check Application Status
            </>
          )}
        </button>
      </div>

      {/* Rejection Modal */}
      {showRejectionModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center"
          onClick={() => setShowRejectionModal(false)}
        >
          <div
            className="bg-white rounded-t-3xl w-full max-w-lg p-6 pb-8"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-steel-grey rounded-full mx-auto mb-5" />

            {/* Icon */}
            <div className="flex justify-center mb-3">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-9 h-9 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>

            <h2 className="font-montserrat font-bold text-xl text-danger text-center mb-4">
              Application Not Approved
            </h2>

            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-5">
              <p className="text-xs font-semibold text-danger mb-2 font-montserrat">Reason</p>
              <p className="text-sm text-ink-black font-montserrat leading-relaxed">{rejectionReason}</p>
            </div>

            <button
              type="button"
              onClick={() => { setShowRejectionModal(false); router.push('/doctor/register') }}
              className="btn-primary w-full h-12 rounded-2xl mb-3"
            >
              Reapply
            </button>
            <button
              type="button"
              onClick={() => { setShowRejectionModal(false); window.location.href = 'mailto:support@dawa.app' }}
              className="btn-outline w-full h-12 rounded-2xl"
            >
              Contact Support
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
