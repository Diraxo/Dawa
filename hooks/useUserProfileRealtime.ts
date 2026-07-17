import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * Keeps a counterpart's name + photo live for the duration of a consultation
 * (call screens, chat screens, incoming-request, waiting-room) — without
 * this, a doctor/patient renaming or replacing their photo mid-consultation
 * leaves the other side showing stale identity for the rest of the session,
 * since these screens otherwise only ever fetch name/photo once (a route
 * param or a mount-time query). Filtered to a single `users.id`, so only use
 * this on single-user screens, not list views with many users on screen.
 */
export function useUserProfileRealtime(
  userRowId: string | null | undefined,
  initialName: string | null | undefined,
  initialPhotoUrl: string | null | undefined
) {
  const [name, setName] = useState<string | null>(initialName ?? null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null)

  useEffect(() => {
    setName(initialName ?? null)
  }, [initialName])

  useEffect(() => {
    setPhotoUrl(initialPhotoUrl ?? null)
  }, [initialPhotoUrl])

  useEffect(() => {
    if (!userRowId) return
    // Suffixed with Date.now() because `supabase.channel()` dedupes by topic
    // string and returns any existing channel for the same topic — if a
    // prior mount's `removeChannel()` (async unsubscribe, then teardown)
    // hasn't finished when this effect re-runs, we'd otherwise get handed
    // back the old, already-subscribed channel and `.on()` would throw
    // ("cannot add postgres_changes callbacks ... after subscribe()").
    const channel = supabase
      .channel(`user-profile-${userRowId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` },
        (payload) => {
          const row = payload.new as any
          if (row?.full_name !== undefined) setName(row.full_name ?? null)
          if (row?.profile_photo_url !== undefined) setPhotoUrl(row.profile_photo_url ?? null)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userRowId])

  return { name, photoUrl }
}
