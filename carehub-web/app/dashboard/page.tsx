'use client'

import { useEffect } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getAuthClient, supabase, supabaseEmailAuth } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

export default function DashboardPage() {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded) return

    async function redirect() {
      // ── Clerk OAuth user ───────────────────────────────────────────────────
      if (user) {
        try {
          const token = await getToken()
          if (!token) { router.replace('/role'); return }
          const client = getAuthClient(token)
          const { data } = await client
            .from('users')
            .select('role')
            .eq('clerk_id', user.id)
            .single()
          if (data?.role === 'patient') router.replace('/patient')
          else if (data?.role === 'doctor') router.replace('/doctor')
          else if (data?.role === 'admin') router.replace('/admin')
          else router.replace('/role')
        } catch {
          router.replace('/role')
        }
        return
      }

      // ── Supabase Auth email user ───────────────────────────────────────────
      const { data: { session } } = await supabaseEmailAuth.auth.getSession()
      if (!session?.user?.id) {
        router.replace('/sign-in')
        return
      }
      try {
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('clerk_id', session.user.id)
          .single()
        if (data?.role === 'patient') router.replace('/patient')
        else if (data?.role === 'doctor') router.replace('/doctor')
        else router.replace('/role')
      } catch {
        router.replace('/role')
      }
    }

    redirect()
  }, [isLoaded, user, getToken, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-cloud-grey">
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={56} variant="dark" />
        <p className="text-ink-black/50 text-sm font-medium font-montserrat">Loading your dashboard…</p>
      </div>
    </div>
  )
}
