import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * Keeps a user's (doctor or patient) photo live on screens that already
 * fetched an initial `profile_photo_url` (e.g. via a `doctor_profiles` or
 * `patient` join) but have no subscription on the `users` row that column
 * actually lives on — without this, an upload/delete from
 * `edit-profile.tsx`/`edit-personal-info.tsx` never reflects here until the
 * screen is refetched/reopened. Filtered to a single `users.id`, so only use
 * this on single-user screens (profile, chat, calls), not list views with
 * many users on screen at once.
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
    // hasn't finished when this effect re-runs, we'd otherwise get handed
    // back the old, already-subscribed channel and `.on()` would throw
    // ("cannot add postgres_changes callbacks ... after subscribe()").
    const channel = supabase
      .channel(`user-photo-${userRowId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` },
        (payload) => setPhotoUrl((payload.new as any)?.profile_photo_url ?? null)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userRowId])

  return photoUrl
}
