import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { getAuthClient } from '@/lib/supabase'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'

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
  const { getToken } = useAuth()
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null)

  useEffect(() => {
    setPhotoUrl(initialPhotoUrl ?? null)
  }, [initialPhotoUrl])

  // Realtime alone misses any change made while this device's socket was
  // suspended in the background — re-fetch once on every foreground return
  // (mirrors useOwnProfilePhoto/useUserProfileRealtime's same guard).
  useEffect(() => {
    if (!userRowId) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then(async (token) => {
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('users')
          .select('profile_photo_url')
          .eq('id', userRowId)
          .maybeSingle()
        if (data) setPhotoUrl(data.profile_photo_url ?? null)
      })
    })
    return () => sub.remove()
  }, [userRowId, getToken])

  useEffect(() => {
    if (!userRowId) return
    // Shared, ref-counted channel: any other hook watching this same `users`
    // row (useOwnProfilePhoto, useUserProfileRealtime) reuses the same
    // subscription instead of opening a duplicate.
    return subscribeRealtime(
      `users:id=eq.${userRowId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` }],
      (_event, payload) => setPhotoUrl((payload.new as any)?.profile_photo_url ?? null),
    )
  }, [userRowId])

  return photoUrl
}
