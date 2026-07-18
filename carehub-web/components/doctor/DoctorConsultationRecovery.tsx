'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

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
 *
 * Wraps `children` and holds off rendering them until the first recovery
 * check resolves, so the dashboard can't paint for a frame before the
 * redirect fires (mirrors the patient-side fix — see
 * components/patient/ActiveConsultationRecovery.tsx). Also carries a
 * Realtime subscription so a doctor sitting on an already-focused,
 * already-rendered tab gets pulled back in without waiting for a
 * visibilitychange/online event (parity with the patient side).
 */
export default function DoctorConsultationRecovery({ children }: { children: React.ReactNode }) {
  const router      = useRouter()
  const pathname    = usePathname()
  const { getToken, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const lastRedirectKeyRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSignedIn) { setReady(true); return }
    if (EXEMPT_PATHS.some(p => pathname.startsWith(p))) { setReady(true); return }

    let cancelled = false

    const recover = async (isInitial: boolean) => {
      try {
        const token = await getToken()
        if (!token) { if (isInitial && !cancelled) setReady(true); return }
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, status')
          .in('status', ACTIVE_STATUSES)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cancelled) return

        if (!data) { if (isInitial) setReady(true); return }

        const key = `${(data as any).id}:${(data as any).status}`
        if (lastRedirectKeyRef.current === key) { if (isInitial) setReady(true); return }
        lastRedirectKeyRef.current = key

        const id   = (data as any).id
        const type = (data as any).type ?? 'chat'
        const base = ROUTE_MAP[type] ?? ROUTE_MAP.chat
        // Stay blocked (ready=false) — the pending navigation lands on an
        // EXEMPT_PATHS route, whose effect run sets ready=true itself.
        router.replace(`${base}/${id}`)
      } catch {
        if (isInitial && !cancelled) setReady(true)
      }
    }

    recover(true)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') recover(false)
    }
    const handleOnline = () => recover(false)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    // Realtime-triggered: a doctor sitting on an already-visible, focused
    // tab (Home, Schedule) when a consultation they've accepted elsewhere
    // (or via a status change from another device) flips into an active
    // status never gets a visibilitychange/online event, so the mount-only
    // check above would miss it. Mirrors the patient-side equivalent.
    let channel: ReturnType<typeof supabase.channel> | null = null
    if (clerkUser?.id) {
      (async () => {
        const token = await getToken()
        if (!token || cancelled) return
        const { data: me } = await getAuthClient(token)
          .from('users')
          .select('id')
          .eq('clerk_id', clerkUser.id)
          .maybeSingle()
        if (!me || cancelled) return

        channel = supabase
          .channel(`doctor-active-consultation-recovery-${(me as any).id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${(me as any).id}` },
            (payload) => {
              const status = (payload.new as { status?: string })?.status
              if (status && (ACTIVE_STATUSES as readonly string[]).includes(status)) recover(false)
            },
          )
          .subscribe()
      })()
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, pathname, clerkUser?.id])

  if (!ready) {
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
