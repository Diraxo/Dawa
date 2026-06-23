'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { supabase, supabaseEmailAuth } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

type Role = 'patient' | 'doctor' | 'admin'

const HOME: Record<Role, string> = {
  patient: '/patient',
  doctor: '/doctor',
  admin: '/admin',
}

// Locks a section to a single role.
// Supports both Clerk OAuth users (Google/Facebook) and Supabase Auth email users.
// Signed-out users go to /sign-in, users without a role row go to /role,
// users with a different role go to their own dashboard.
// Doctors are additionally routed by approval status.
export default function RoleGuard({ allow, children }: { allow: Role; children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!clerkLoaded) return
    let cancelled = false

    async function check() {
      let clerkId: string | null = clerkUser?.id ?? null

      if (!clerkId) {
        // No Clerk session — check for Supabase Auth session (email+password users)
        const { data: { session } } = await supabaseEmailAuth.auth.getSession()
        if (!session?.user?.id) {
          router.replace('/sign-in')
          return
        }
        clerkId = session.user.id
      }

      if (cancelled) return

      // `supabase` auto-uses the right JWT (Clerk or Supabase Auth) via the fallback
      const { data } = await supabase
        .from('users')
        .select('id, role')
        .eq('clerk_id', clerkId)
        .maybeSingle()

      if (cancelled) return
      const role = data?.role as Role | undefined
      if (!data || !role) { router.replace('/role'); return }
      if (role !== allow) { router.replace(HOME[role] ?? '/role'); return }

      if (allow === 'doctor') {
        const { data: profile } = await supabase
          .from('doctor_profiles')
          .select('status')
          .eq('user_id', data.id)
          .maybeSingle()
        if (cancelled) return
        const onRegister = pathname.startsWith('/doctor/register')
        const onReview = pathname.startsWith('/doctor/under-review')
        if (!profile) {
          if (!onRegister) { router.replace('/doctor/register'); return }
        } else {
          // Already registered — bounce away from the registration form
          if (onRegister) { router.replace('/doctor'); return }
          // Under-review: only bounce once approved (pending/rejected may stay to check status or reapply)
          if (onReview && profile.status === 'approved') { router.replace('/doctor'); return }
          // All other paths: let through regardless of approval status.
          // Home and profile pages show a banner when status !== 'approved'.
        }
      }

      setAllowed(true)
    }

    check()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkLoaded, clerkUser?.id, pathname])

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cloud-grey">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={56} variant="dark" />
          <p className="text-ink-black/50 text-sm font-medium font-montserrat">Loading…</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
