import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '@clerk/clerk-expo'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { getAuthClient, supabase } from '@/lib/supabase'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'

const cacheKey = (clerkUserId: string) => `own-profile-photo:${clerkUserId}`

// In-memory cache so switching tabs within the same app session shows the
// photo instantly (no network round-trip); AsyncStorage backs it across
// cold starts. Without either, the avatar briefly falls back to the
// initial-letter placeholder every time this hook mounts while the
// Clerk-token + Supabase round-trip is in flight.
const _memoryCache = new Map<string, string | null>()

/**
 * Single source of truth for the signed-in user's own profile photo
 * (doctor or patient) — reads `users.profile_photo_url` (not Clerk's
 * `user.imageUrl`, which only ever reflects the OAuth/Clerk avatar and
 * never an uploaded photo), and stays live via Realtime so an upload/delete
 * from any session (this device, another device, admin) shows up
 * immediately with no refresh.
 */
export function useOwnProfilePhoto() {
  const { userId: clerkUserId, getToken } = useAuth()
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    () => (clerkUserId ? _memoryCache.get(clerkUserId) ?? null : null)
  )
  const [userRowId, setUserRowId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!clerkUserId) return
    const token = await getToken()
    if (!token) return
    const { data } = await getAuthClient(token)
      .from('users')
      .select('id, profile_photo_url')
      .eq('clerk_id', clerkUserId)
      .maybeSingle()
    if (data) {
      setUserRowId(data.id)
      setPhotoUrl(data.profile_photo_url ?? null)
      _memoryCache.set(clerkUserId, data.profile_photo_url ?? null)
      AsyncStorage.setItem(cacheKey(clerkUserId), data.profile_photo_url ?? '').catch(() => {})
    }
  }, [clerkUserId, getToken])

  // Hydrate instantly from the last-known photo (memory, then disk) so the
  // avatar never flashes the default placeholder while the network fetch
  // above is still in flight — then `refresh()` reconciles with the DB.
  useEffect(() => {
    if (!clerkUserId) return
    const cached = _memoryCache.get(clerkUserId)
    if (cached !== undefined) {
      setPhotoUrl(cached)
      return
    }
    AsyncStorage.getItem(cacheKey(clerkUserId))
      .then((stored) => {
        if (stored) {
          setPhotoUrl(stored)
          _memoryCache.set(clerkUserId, stored)
        }
      })
      .catch(() => {})
  }, [clerkUserId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime alone misses any change made while this device's socket was
  // suspended in the background (the OS drops the connection, and missed
  // events aren't retroactively redelivered on reconnect) — re-fetch once on
  // every foreground return so a photo changed elsewhere while backgrounded
  // shows up immediately instead of only on next remount. Mirrors
  // useDoctorOnlineToggle's resyncOnForeground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh()
    })
    return () => sub.remove()
  }, [refresh])

  useEffect(() => {
    if (!userRowId) return
    // Shared, ref-counted channel: this hook mounts on multiple sibling tabs
    // at once (Home, Profile), plus other hooks (useUserPhotoRealtime,
    // useUserProfileRealtime) watch this same `users` row — all of them
    // reuse one subscription per row instead of each opening a duplicate.
    return subscribeRealtime(
      `users:id=eq.${userRowId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userRowId}` }],
      (_event, payload) => {
        const next = (payload.new as any)?.profile_photo_url ?? null
        setPhotoUrl(next)
        if (clerkUserId) {
          _memoryCache.set(clerkUserId, next)
          AsyncStorage.setItem(cacheKey(clerkUserId), next ?? '').catch(() => {})
        }
      },
    )
  }, [userRowId, clerkUserId])

  return { photoUrl, refresh, userRowId }
}
