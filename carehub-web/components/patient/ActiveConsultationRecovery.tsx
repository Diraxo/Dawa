'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import LogoMark from '@/components/ui/LogoMark'

const ROUTE_MAP: Record<string, string> = {
  chat:  '/patient/consultation/chat',
  phone: '/patient/consultation/phone',
  video: '/patient/consultation/video',
}

// Paths where we must NOT auto-redirect — the patient is already inside the
// waiting room or the live consultation for this (or another) session.
const EXEMPT_PATHS = ['/patient/consultation/', '/patient/waiting/', '/patient/summary/']

const ACTIVE_STATUSES = ['waiting_for_doctor', 'accepted', 'in_progress', 'active'] as const

// completed/declined are terminal, not ongoing — only auto-redirect for them
// within a short window of the resolution itself (the "patient was away when
// it wrapped up, now they're back" case the spec calls out), not forever, or
// every future app open would keep bouncing the patient back into an old
// summary/decline screen instead of wherever they navigated afterward.
const RESOLVED_STATUSES = ['completed', 'declined'] as const
const RESOLVED_WINDOW_MS = 30 * 60 * 1000

/**
 * Hard, non-dismissible recovery: if the patient has any active consultation,
 * they are redirected straight back into it — from Home, Doctors,
 * Appointments, Messages, Profile, anywhere — instead of being shown a
 * dismissible "Resume" banner. This must survive refresh, tab close/reopen,
 * and losing/regaining connectivity.
 *
 * Wraps `children` (rather than being a side-effect-only sibling) and holds
 * off rendering them until the first recovery check resolves — otherwise
 * Home/Appointments/etc paint for one frame before the redirect fires,
 * because the async auth+DB check can't beat the page's own render.
 */
export default function ActiveConsultationRecovery({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { getToken, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const lastRedirectKeyRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSignedIn) { setReady(true); return }

    // Already inside the consultation flow — nothing to redirect away from,
    // and nothing worth blocking render for.
    if (EXEMPT_PATHS.some(p => pathname.startsWith(p))) { setReady(true); return }

    let cancelled = false

    const recover = async (isInitial: boolean) => {
      try {
        const token = await getToken()
        if (!token) { if (isInitial && !cancelled) setReady(true); return }
        const resolvedSince = new Date(Date.now() - RESOLVED_WINDOW_MS).toISOString()
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, status, updated_at')
          .or(
            `status.in.(${ACTIVE_STATUSES.join(',')}),` +
            `and(status.in.(${RESOLVED_STATUSES.join(',')}),updated_at.gte.${resolvedSince})`
          )
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cancelled) return

        if (!data) { if (isInitial) setReady(true); return }

        const key = `${(data as any).id}:${(data as any).status}`
        if (lastRedirectKeyRef.current === key) { if (isInitial) setReady(true); return }
        lastRedirectKeyRef.current = key

        const id     = (data as any).id
        const type   = (data as any).type ?? 'chat'
        const status = (data as any).status

        // Stay blocked (ready=false) — the pending navigation lands on an
        // EXEMPT_PATHS route, whose effect run sets ready=true itself.
        if (status === 'waiting_for_doctor' || status === 'declined') {
          // 'declined' is rendered in-place by the waiting-room page itself
          // (credit-preserved messaging) — there is no separate screen for it.
          router.replace(`/patient/waiting/${id}`)
        } else if (status === 'completed') {
          // A review already on file (DB is the source of truth) means the
          // patient already finished the post-call rating flow — the
          // consultation is historical now (Appointments > Past), not a
          // recovery target. Without this check, this effect re-running on
          // every refresh/tab-focus/realtime UPDATE kept force-navigating an
          // already-rated patient back to /patient/summary/[id], which then
          // had to tell them "you have already rated this consultation".
          const { data: existingReview } = await getAuthClient(token)
            .from('reviews')
            .select('id')
            .eq('consultation_id', id)
            .maybeSingle()
          if (cancelled) return
          if (existingReview) {
            if (isInitial) setReady(true)
            return
          }
          router.replace(`/patient/summary/${id}`)
        } else {
          const base = ROUTE_MAP[type] ?? ROUTE_MAP.chat
          router.replace(`${base}/${id}`)
        }
      } catch {
        // Best-effort — next focus/visibility tick retries. Don't block
        // rendering forever on a transient failure.
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

    // Realtime-triggered: a patient sitting on an already-visible, focused
    // tab (Home, Appointments) when the per-minute cron flips their
    // scheduled booking to 'waiting_for_doctor' never gets a visibilitychange
    // or 'online' event, so the mount-only check above would miss it. Mirrors
    // the mobile app's equivalent fix in app/_layout.tsx.
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
          .channel(`patient-active-consultation-recovery-${(me as any).id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `patient_id=eq.${(me as any).id}` },
            (payload) => {
              const status = (payload.new as { status?: string })?.status
              if (
                status &&
                ((ACTIVE_STATUSES as readonly string[]).includes(status) ||
                  (RESOLVED_STATUSES as readonly string[]).includes(status))
              ) recover(false)
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
