import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Keeps a single user's (doctor or patient) photo live once a screen has
 * already fetched an initial `profile_photo_url` via a join (e.g.
 * `doctor_profiles -> users` or `patient -> users`) — that join has no
 * Realtime subscription of its own, so an upload/delete from the owning
 * user's own profile page never reflects on the other party's screens until
 * a refetch. Mirrors the mobile `hooks/useUserPhotoRealtime.ts` hook.
 * Filtered client-side by `userRowId`, so only use on single-user screens,
 * not list views.
 */
export function useUserPhotoRealtime(userRowId: string | null | undefined, initialPhotoUrl: string | null | undefined) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null)

  useEffect(() => {
    setPhotoUrl(initialPhotoUrl ?? null)
  }, [initialPhotoUrl])

  useEffect(() => {
    if (!userRowId) return
    // Suffixed with Date.now() because `supabase.channel()` dedupes by topic
    // string and returns any existing channel for the same topic — if a
    // prior mount's `removeChannel()` (async unsubscribe, then teardown)
    // hasn't finished when this effect re-runs (e.g. React StrictMode's
    // double-invoke), we'd otherwise get handed back the old,
    // already-subscribed channel and `.on()` would throw ("cannot add
    // postgres_changes callbacks ... after subscribe()").
    const channel = supabase
      .channel(`user-photo-${userRowId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` },
        (payload) => setPhotoUrl((payload.new as { profile_photo_url: string | null })?.profile_photo_url ?? null)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userRowId])

  return photoUrl
}
