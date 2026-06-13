'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

export default function UnderReviewPage() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()

  useEffect(() => {
    async function checkStatus() {
      const token = await getToken()
      if (!token || !user) return
      const client = getAuthClient(token)
      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!userData) return
      const { data: profile } = await client
        .from('doctor_profiles')
        .select('status')
        .eq('user_id', userData.id)
        .single()
      if (profile?.status === 'approved') {
        router.push('/doctor')
      }
    }
    checkStatus()
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <div className="min-h-screen bg-cloud-grey flex items-center justify-center p-6">
      <div className="card p-10 max-w-lg w-full text-center">
        {/* Animated clock */}
        <div className="text-6xl mb-6 animate-spin-slow inline-block">⏳</div>

        <h1 className="font-montserrat font-black text-2xl text-ink-black mb-3">
          Application Under Review
        </h1>
        <p className="text-ink-black/60 text-sm leading-relaxed mb-6">
          Our admin team is reviewing your application and documents. This usually takes
          1–3 business days. You&apos;ll receive an email notification once a decision is made.
        </p>

        {/* Steps */}
        <div className="flex flex-col gap-3 mb-8 text-left">
          {[
            { icon: '✅', label: 'Application submitted', done: true },
            { icon: '🔍', label: 'Documents under review', done: true, active: true },
            { icon: '📧', label: 'Email notification sent', done: false },
            { icon: '🟢', label: 'Account activated', done: false },
          ].map((step, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${step.active ? 'bg-info/8 border border-info/20' : ''}`}>
              <span className="text-lg">{step.icon}</span>
              <span className={`font-montserrat text-sm ${step.done ? 'text-ink-black font-semibold' : 'text-ink-black/40'}`}>
                {step.label}
              </span>
              {step.active && (
                <span className="ml-auto text-[10px] text-info font-bold bg-info/10 px-2 py-0.5 rounded-full">In Progress</span>
              )}
            </div>
          ))}
        </div>

        <div className="bg-cloud-grey rounded-2xl p-4 mb-6 text-left">
          <p className="text-[10px] font-bold text-ink-black/40 uppercase tracking-wider mb-2">What happens next?</p>
          <ul className="text-sm text-ink-black/60 space-y-1">
            <li>• Admin verifies your license and credentials</li>
            <li>• You&apos;ll receive an approval or rejection email</li>
            <li>• If approved, log in again to access your dashboard</li>
            <li>• If rejected, the reason will be included in the email</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <Link href="/" className="btn-outline flex-1 text-sm h-10 rounded-xl">
            Back to Home
          </Link>
          <Link href="/doctor/register" className="btn-primary flex-1 text-sm h-10 rounded-xl">
            Edit Application
          </Link>
        </div>
      </div>
    </div>
  )
}
