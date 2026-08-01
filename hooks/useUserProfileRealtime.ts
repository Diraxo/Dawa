import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { getAuthClient } from '@/lib/supabase'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'

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
  const { getToken } = useAuth()
  const [name, setName] = useState<string | null>(initialName ?? null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null)

  useEffect(() => {
    setName(initialName ?? null)
  }, [initialName])

  useEffect(() => {
    setPhotoUrl(initialPhotoUrl ?? null)
  }, [initialPhotoUrl])

  // Realtime alone misses any change made while this device's socket was
  // suspended in the background (the OS drops the connection, and missed
  // events aren't retroactively redelivered on reconnect) — re-fetch once on
  // every foreground return so a counterpart's name/photo change made mid-
  // consultation while this device was backgrounded still shows up.
  useEffect(() => {
    if (!userRowId) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then(async (token) => {
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('users')
          .select('full_name, profile_photo_url')
          .eq('id', userRowId)
          .maybeSingle()
        if (data) {
          setName(data.full_name ?? null)
          setPhotoUrl(data.profile_photo_url ?? null)
        }
      })
    })
    return () => sub.remove()
  }, [userRowId, getToken])

  useEffect(() => {
    if (!userRowId) return
    // Shared, ref-counted channel: any other hook watching this same `users`
    // row (useOwnProfilePhoto, useUserPhotoRealtime) reuses the same
    // subscription instead of opening a duplicate.
    return subscribeRealtime(
      `users:id=eq.${userRowId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` }],
      (_event, payload) => {
        const row = payload.new as any
        if (row?.full_name !== undefined) setName(row.full_name ?? null)
        if (row?.profile_photo_url !== undefined) setPhotoUrl(row.profile_photo_url ?? null)
      },
    )
  }, [userRowId])

  return { name, photoUrl }
}
