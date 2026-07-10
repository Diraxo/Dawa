'use client'

import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

const ROUTE_MAP: Record<string, string> = {
  chat:  '/doctor/consultation/chat',
  phone: '/doctor/consultation/phone',
  video: '/doctor/consultation/video',
}

// Paths where we must NOT auto-redirect — already inside the live consultation.
const EXEMPT_PATHS = ['/doctor/consultation/']

const ACTIVE_STATUSES = ['accepted', 'in_progress', 'active'] as const

/**
 * Hard, non-dismissible recovery: if the doctor has any consultation they've
 * already accepted (or is in progress), they are redirected straight back
 * into it from anywhere in the dashboard — instead of a dismissible "Resume"
 * banner. Pre-accept requests (status 'waiting_for_doctor') are intentionally
 * excluded here since IncomingRequestOverlay already surfaces those globally
 * as a modal the doctor must Accept/Decline.
 */
export default function DoctorConsultationRecovery() {
  const router      = useRouter()
  const pathname    = usePathname()
  const { getToken, isSignedIn } = useAuth()
  const lastRedirectKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    if (EXEMPT_PATHS.some(p => pathname.startsWith(p))) return

    const recover = async () => {
      try {
        const token = await getToken()
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, status')
          .in('status', ACTIVE_STATUSES)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!data) return

        const key = `${(data as any).id}:${(data as any).status}`
        if (lastRedirectKeyRef.current === key) return
        lastRedirectKeyRef.current = key

        const id   = (data as any).id
        const type = (data as any).type ?? 'chat'
        const base = ROUTE_MAP[type] ?? ROUTE_MAP.chat
        router.replace(`${base}/${id}`)
      } catch {
        // Best-effort — next focus/visibility tick retries.
      }
    }

    recover()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') recover()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', recover)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', recover)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, pathname])

  return null
}
