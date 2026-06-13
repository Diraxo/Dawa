'use client'

export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import { User, Stethoscope } from 'lucide-react'
import { getAuthClient, supabase, supabaseEmailAuth } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

type Role = 'patient' | 'doctor'

export default function RolePage() {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const [selected, setSelected] = useState<Role | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  // ── Re-entry: if the user already has a role, skip the picker ─────────────
  useEffect(() => {
    if (!isLoaded) return

    async function checkExistingRole() {
      // Clerk OAuth user
      if (user) {
        try {
          const token = await getToken()
          if (!token) { setChecking(false); return }
          const client = getAuthClient(token)
          const { data } = await client
            .from('users')
            .select('role')
            .eq('clerk_id', user.id)
            .single()
          if (data?.role === 'patient') { router.replace('/patient'); return }
          if (data?.role === 'doctor') { router.replace('/doctor'); return }
          if (data?.role === 'admin') { router.replace('/admin'); return }
        } catch {}
        setChecking(false)
        return
      }

      // Supabase Auth email user
      const { data: { session } } = await supabaseEmailAuth.auth.getSession()
      if (!session?.user?.id) { setChecking(false); return }
      try {
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('clerk_id', session.user.id)
          .single()
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
    try {
      // Clerk OAuth user
      if (user) {
        const token = await getToken()
        if (token) {
          const client = getAuthClient(token)
          await client.from('users').upsert({
            clerk_id: user.id,
            email: user.emailAddresses[0]?.emailAddress ?? '',
            full_name: user.fullName ?? '',
            role: selected,
          }, { onConflict: 'clerk_id' })
        }
        router.push(selected === 'patient' ? '/patient' : '/doctor/register')
        return
      }

      // Supabase Auth email user
      const { data: { session } } = await supabaseEmailAuth.auth.getSession()
      if (session?.user) {
        await supabase.from('users').upsert({
          clerk_id: session.user.id,
          email: session.user.email ?? '',
          full_name: (session.user.user_metadata?.full_name as string) ?? '',
          role: selected,
        }, { onConflict: 'clerk_id' })
      }
      router.push(selected === 'patient' ? '/patient' : '/doctor/register')
    } catch {
      router.push(selected === 'patient' ? '/patient' : '/doctor/register')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={56} />
          <p className="text-ink-black/50 text-sm font-medium font-montserrat">Loading your account…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-2.5">
            <LogoMark size={40} />
            <span className="font-montserrat font-bold text-2xl text-ink-black">
              CARE<span className="text-teal-green">HUB</span>
            </span>
          </div>
        </div>

        <div className="card p-8">
          <div className="text-center mb-8">
            <h1 className="font-montserrat font-black text-3xl text-ink-black mb-2">
              Which one are you?
            </h1>
            <p className="text-ink-black/60 text-sm">
              We&apos;ll tailor your experience based on your role.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            {(['patient', 'doctor'] as Role[]).map(role => (
              <motion.button
                key={role}
                onClick={() => setSelected(role)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`relative rounded-3xl p-6 flex flex-col items-center gap-3 border-2 transition-all duration-200 ${
                  selected === role
                    ? 'border-transparent bg-white shadow-card-lg'
                    : 'border-steel-grey bg-white hover:border-int-blue/30'
                }`}
              >
                {selected === role && (
                  <div className="absolute inset-0 rounded-3xl border-2 border-transparent"
                    style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(to right, #2962FF, #00BFA5) border-box' }} />
                )}
                <div className={`w-16 h-16 rounded-3xl flex items-center justify-center ${
                  selected === role ? 'bg-gradient-interactive' : 'bg-cloud-grey'
                }`}>
                  {role === 'patient'
                    ? <User size={32} className={selected === role ? 'text-white' : 'text-care-blue'} />
                    : <Stethoscope size={32} className={selected === role ? 'text-white' : 'text-teal-green'} />}
                </div>
                <div className="text-center">
                  <p className={`font-montserrat font-bold text-base ${
                    selected === role ? 'gradient-interactive-text' : 'text-ink-black'
                  }`}>
                    {role === 'patient' ? 'Patient' : 'Healthcare\nProfessional'}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>

          <button
            onClick={handleContinue}
            disabled={!selected || loading}
            className="btn-primary w-full disabled:opacity-40"
          >
            {loading ? 'Setting up…' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  )
}
