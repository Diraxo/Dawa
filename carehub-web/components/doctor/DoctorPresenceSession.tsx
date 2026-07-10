'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'

const HEARTBEAT_MS = 60_000 // matches the mobile app's ping interval / the 2-min server TTL
const HIDDEN_GRACE_MS = 20_000 // matches the mobile app's AppState background grace window

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Mounted once for the whole doctor dashboard (components/doctor/Shell.tsx),
 * this owns two things the web app previously had no equivalent for (mobile
 * has both via app/(doctor)/_layout.tsx + hooks/useDoctorPresenceHeartbeat):
 *
 * 1. A 60s heartbeat that pings doctor_profiles.last_seen_at while is_online
 *    is true, so the server-side mark_stale_doctors_offline() TTL sweep
 *    (migration 042) doesn't force-flip a doctor offline within a minute of
 *    them going online from the web — it previously had no web heartbeat at
 *    all, so that sweep would have force-flipped every web session offline.
 * 2. Best-effort is_online=false on tab close / navigation away (pagehide)
 *    and after a grace window of the tab being hidden (visibilitychange),
 *    mirroring the mobile AppState background grace-timer so briefly
 *    switching tabs doesn't flap the doctor's status. Uses fetch with
 *    keepalive so the request can survive page teardown — normal
 *    supabase-js requests are routinely dropped mid-flight on unload.
 */
export default function DoctorPresenceSession() {
  const { getToken, userId } = useAuth()
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(false)

  const doctorProfileIdRef = useRef<string | null>(null)
  const isOnlineRef = useRef(false)
  const lastTokenRef = useRef<string | null>(null)
  // Kept current so the tab-close/hidden-grace flip below never marks a
  // doctor offline mid-consultation (same exception as the server-side TTL
  // sweep in migration 042 / is_doctor_busy from migration 047).
  const isBusyRef = useRef(false)
  useEffect(() => { doctorProfileIdRef.current = doctorProfileId }, [doctorProfileId])
  useEffect(() => { isOnlineRef.current = isOnline }, [isOnline])

  // ── Resolve this doctor's profile id + current status ──────────────────────
  useEffect(() => {
    if (!userId) return
    let mounted = true
    ;(async () => {
      const token = await getToken()
      if (!token || !mounted) return
      lastTokenRef.current = token
      const client = getAuthClient(token)
      const { data: userRow } = await client.from('users').select('id').eq('clerk_id', userId).maybeSingle()
      if (!userRow || !mounted) return
      const { data: dp } = await client
        .from('doctor_profiles')
        .select('id, is_online')
        .eq('user_id', userRow.id)
        .maybeSingle()
      if (!dp || !mounted) return
      setDoctorProfileId(dp.id)
      setIsOnline(dp.is_online ?? false)
    })()
    return () => { mounted = false }
  }, [userId, getToken])

  // ── Track is_online live — the toggle button writes to the DB directly and
  // doesn't know about this component's local state ──────────────────────────
  useEffect(() => {
    if (!doctorProfileId) return
    const channel = supabase
      .channel(`doctor-presence-session-web-${doctorProfileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorProfileId}` },
        (payload) => setIsOnline((payload.new as any)?.is_online ?? false)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [doctorProfileId])

  // ── Heartbeat ping while online ─────────────────────────────────────────────
  useEffect(() => {
    if (!doctorProfileId || !isOnline) return
    let cancelled = false

    const ping = async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        lastTokenRef.current = token
        await getAuthClient(token)
          .from('doctor_profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', doctorProfileId)
      } catch {
        // Network failure — next tick retries.
      }
    }

    ping()
    const interval = setInterval(ping, HEARTBEAT_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [doctorProfileId, isOnline, getToken])

  // ── Keep isBusyRef current ──────────────────────────────────────────────────
  useEffect(() => {
    if (!doctorProfileId) return
    let cancelled = false

    const refreshBusy = async () => {
      const token = lastTokenRef.current ?? (await getToken())
      if (!token || cancelled) return
      const { data } = await getAuthClient(token).rpc('is_doctor_busy', { p_doctor_id: doctorProfileId })
      if (!cancelled) isBusyRef.current = !!data
    }

    refreshBusy()
    const channel = supabase
      .channel(`doctor-presence-busy-web-${doctorProfileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${doctorProfileId}` },
        () => { refreshBusy() }
      )
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [doctorProfileId, getToken])

  // ── Flip offline on tab close / navigation away, or after being hidden too
  // long ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPABASE_URL) return
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null

    const flipOffline = () => {
      const id = doctorProfileIdRef.current
      const token = lastTokenRef.current
      if (!id || !isOnlineRef.current || !token || isBusyRef.current) return
      try {
        // keepalive lets this request survive page teardown — a plain
        // supabase-js call here is routinely cancelled mid-flight on unload.
        fetch(`${SUPABASE_URL}/rest/v1/doctor_profiles?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ is_online: false }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // best-effort; the server-side TTL sweep is the safety net
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(flipOffline, HIDDEN_GRACE_MS)
      } else if (hiddenTimer) {
        clearTimeout(hiddenTimer)
        hiddenTimer = null
      }
    }

    const handlePageHide = () => {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null }
      flipOffline()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      if (hiddenTimer) clearTimeout(hiddenTimer)
    }
  }, [])

  return null
}
