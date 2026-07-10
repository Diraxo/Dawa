import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-expo'

import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorPresenceHeartbeat } from './useDoctorPresenceHeartbeat'

/**
 * Owns the doctor's presence heartbeat for the entire signed-in session —
 * mounted once in app/(doctor)/_layout.tsx so last_seen_at keeps getting
 * pinged every 60s while is_online is true, regardless of which doctor
 * screen is currently focused (home tab, an active consultation, etc.).
 *
 * Previously the heartbeat only ran while (tabs)/home.tsx was mounted, so it
 * silently stopped the moment a doctor navigated into a live consultation —
 * last_seen_at would go stale ~2 minutes into any call, and the server-side
 * mark_stale_doctors_offline() TTL sweep would flip them offline mid-call.
 */
export function useDoctorPresenceSession(enabled: boolean) {
  const { getToken, userId: clerkUserId } = useAuth()
  const [doctorProfileId, setDoctorProfileId] = useState<string | undefined>()
  const [isOnline, setIsOnline] = useState(false)

  useEffect(() => {
    if (!enabled || !clerkUserId) {
      setDoctorProfileId(undefined)
      setIsOnline(false)
      return
    }
    let mounted = true

    ;(async () => {
      const token = await getToken()
      if (!token || !mounted) return
      const client = getAuthClient(token)
      const { data: userRow } = await client.from('users').select('id').eq('clerk_id', clerkUserId).maybeSingle()
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clerkUserId])

  // Track is_online live so the heartbeat starts/stops the instant the
  // doctor toggles from any screen — the toggle UI (tabs/home.tsx) writes to
  // the DB directly and doesn't know about this hook's local state.
  useEffect(() => {
    if (!doctorProfileId) return
    const channel = supabase
      .channel(`doctor-presence-session-${doctorProfileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorProfileId}` },
        (payload) => setIsOnline((payload.new as any)?.is_online ?? false)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [doctorProfileId])

  useDoctorPresenceHeartbeat(doctorProfileId, enabled && isOnline)
}
