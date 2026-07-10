'use client'

import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

const ROUTE_MAP: Record<string, string> = {
  chat:  '/patient/consultation/chat',
  phone: '/patient/consultation/phone',
  video: '/patient/consultation/video',
}

// Paths where we must NOT auto-redirect — the patient is already inside the
// waiting room or the live consultation for this (or another) session.
const EXEMPT_PATHS = ['/patient/consultation/', '/patient/waiting/']

const ACTIVE_STATUSES = ['waiting_for_doctor', 'accepted', 'in_progress', 'active'] as const

/**
 * Hard, non-dismissible recovery: if the patient has any active consultation,
 * they are redirected straight back into it — from Home, Doctors,
 * Appointments, Messages, Profile, anywhere — instead of being shown a
 * dismissible "Resume" banner. This must survive refresh, tab close/reopen,
 * and losing/regaining connectivity.
 */
export default function ActiveConsultationRecovery() {
  const router   = useRouter()
  const pathname = usePathname()
  const { getToken, isSignedIn } = useAuth()
  const lastRedirectKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSignedIn) return

    // Already inside the consultation flow — nothing to redirect away from.
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

        const id     = (data as any).id
        const type   = (data as any).type ?? 'chat'
        const status = (data as any).status

        if (status === 'waiting_for_doctor') {
          router.replace(`/patient/waiting/${id}`)
        } else {
          const base = ROUTE_MAP[type] ?? ROUTE_MAP.chat
          router.replace(`${base}/${id}`)
        }
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
