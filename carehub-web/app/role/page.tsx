'use client'

export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'
import Image from 'next/image'
import Link from 'next/link'
import { getAuthClient, supabase, supabaseEmailAuth } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

type Role = 'patient' | 'doctor'

// A stale `users` row from a previous account (deleted via Clerk Dashboard,
// or a client-side delete interrupted before its own anonymization update
// ran) can still hold this email under a different clerk_id — the upsert's
// onConflict: 'clerk_id' then tries an INSERT, which collides with the
// separate users_email_key constraint. Not something retrying fixes.
function describeUpsertError(upsertError: { code?: string; message?: string }): string {
  const msg = upsertError.message?.toLowerCase() ?? ''
  if (upsertError.code === '23505' && msg.includes('email')) {
    return 'This email is already linked to a Dawa account that could not be fully removed. Please contact support to finish clearing it before signing up again.'
  }
  return 'Something went wrong while saving your profile. Please try again or contact support.'
}

export default function RolePage() {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [selected, setSelected] = useState<Role | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isLoaded) return
    async function checkExistingRole() {
      if (user) {
        try {
          const token = await getToken()
          if (!token) { setChecking(false); return }
          const client = getAuthClient(token)
          const { data } = await client.from('users').select('role').eq('clerk_id', user.id).single()
          if (data?.role === 'patient') { router.replace('/patient'); return }
          if (data?.role === 'doctor') { router.replace('/doctor'); return }
          if (data?.role === 'admin') { router.replace('/admin'); return }
        } catch {}
        setChecking(false)
        return
      }
      const { data: { session } } = await supabaseEmailAuth.auth.getSession()
      if (!session?.user?.id) { setChecking(false); return }
      try {
        const { data } = await supabase.from('users').select('role').eq('clerk_id', session.user.id).single()
        if (data?.role === 'patient') { router.replace('/patient'); return }
        if (data?.role === 'doctor') { router.replace('/doctor'); return }
      } catch {}
      setChecking(false)
    }
    checkExistingRole()
  }, [isLoaded, user, getToken, router])

  async function handleContinue() {
    if (!selected || loading) return
    setLoading(true)
    setError('')
    try {
      if (user) {
        const token = await getToken()
        if (token) {
          const client = getAuthClient(token)
          const { error: upsertError } = await client.from('users').upsert({
            clerk_id: user.id,
            email: user.emailAddresses[0]?.emailAddress ?? '',
            full_name: user.fullName ?? '',
            profile_photo_url: user.imageUrl ?? null,
            role: selected,
            country: '',
            language: 'en',
          }, { onConflict: 'clerk_id' })
          if (upsertError) {
            console.error('[role] users upsert failed:', upsertError)
            setError(describeUpsertError(upsertError))
            return
          }
        }
        router.push(selected === 'patient' ? '/patient' : '/doctor/register')
        return
      }
      const { data: { session } } = await supabaseEmailAuth.auth.getSession()
      if (session?.user) {
        const { error: upsertError } = await supabase.from('users').upsert({
          clerk_id: session.user.id,
          email: session.user.email ?? '',
          full_name: (session.user.user_metadata?.full_name as string) ?? '',
          role: selected,
          country: '',
          language: 'en',
        }, { onConflict: 'clerk_id' })
        if (upsertError) {
          console.error('[role] users upsert failed:', upsertError)
          setError(describeUpsertError(upsertError))
          return
        }
      }
      router.push(selected === 'patient' ? '/patient' : '/doctor/register')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={56} variant="dark" />
          <p className="text-ink-black/50 text-sm font-medium font-montserrat">Loading your account…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
      {/* Top nav — back arrow left, logo center */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/sign-in" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex items-center gap-2">
          <LogoMark size={32} variant="dark" />
          <span className="font-montserrat font-bold text-lg text-ink-black">
            DA<span className="text-teal-green">WA</span>
          </span>
        </div>
        <div className="w-10" />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center px-6 pt-6">
        <h1 className="font-montserrat font-black text-4xl text-ink-black text-center mb-3">
          Which one are you?
        </h1>
        <p className="text-ink-black/50 text-sm text-center max-w-xs mb-10">
          We will use it to provide you services and recommendations.
        </p>

        {/* Role cards */}
        <div className="flex gap-5 w-full max-w-sm mb-auto items-stretch">
          {(['patient', 'doctor'] as Role[]).map(role => {
            const isSelected = selected === role
            const label = role === 'patient' ? 'Patient' : 'Doctor'
            const labelColor = role === 'patient' ? '#111827' : '#00BFA5'
            const imgSrc = role === 'patient' ? '/patient-card.jpg' : '/doctor-card.jpg'

            const cardContent = (
              <div className="flex flex-col h-full">
                <div className="w-full flex-1 overflow-hidden" style={{ minHeight: 200 }}>
                  <Image
                    src={imgSrc}
                    alt={label}
                    width={300}
                    height={260}
                    className="object-cover w-full h-full"
                    style={{ display: 'block' }}
                  />
                </div>
                <div className="py-4 flex items-center justify-center">
                  <p className="font-montserrat font-bold text-[15px]" style={{ color: labelColor }}>
                    {label}
                  </p>
                </div>
              </div>
            )

            return (
              <button
                key={role}
                onClick={() => setSelected(role)}
                className="flex-1 flex flex-col outline-none focus:outline-none"
                style={{ transform: isSelected ? 'scale(1.04)' : 'scale(1)', transition: 'transform 0.2s ease' }}
              >
                {isSelected ? (
                  <div
                    className="w-full h-full rounded-[20px] p-[3px]"
                    style={{ background: 'linear-gradient(135deg, #2962FF, #00BFA5)' }}
                  >
                    <div className="bg-white rounded-[17px] overflow-hidden h-full">
                      {cardContent}
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-full h-full rounded-[20px] bg-white overflow-hidden"
                    style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  >
                    {cardContent}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom — continue button */}
      <div className="px-6 pb-8 pt-6">
        {error && <p className="text-danger text-sm text-center mb-3 font-montserrat">{error}</p>}
        <button
          onClick={handleContinue}
          disabled={!selected || loading}
          className="w-full h-[52px] rounded-2xl font-montserrat font-bold text-base text-white transition-opacity disabled:opacity-60"
          style={{
            background: selected
              ? 'linear-gradient(to right, #2962FF, #00BFA5)'
              : '#D4D9E1',
            color: selected ? '#FFFFFF' : '#9CA3AF',
          }}
        >
          {loading ? 'Setting up…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
