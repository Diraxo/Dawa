import { useAuth } from '@clerk/clerk-expo'
import { useCallback, useEffect, useState } from 'react'
import { Alert, AppState } from 'react-native'

import { getAuthClient, supabase } from '@/lib/supabase'

/**
 * Single write path + realtime subscription for `doctor_profiles.is_online`,
 * shared by every screen with an online/offline toggle (currently mobile
 * Home and Schedule tabs, previously two near-identical implementations).
 * Callers own their own initial fetch (usually part of a larger combined
 * profile query) and seed state via the returned `setIsOnline`.
 */
export function useDoctorOnlineToggle(doctorProfileId: string | null, opts?: { resyncOnForeground?: boolean }) {
  const { getToken } = useAuth()
  const [isOnline, setIsOnline] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Live-reflect is_online changes made from another session (website,
  // another device, or this same doctor's other mobile tab).
  useEffect(() => {
    if (!doctorProfileId) return
    // Suffixed with Date.now() because this hook mounts on multiple sibling
    // tabs at once (Home, Schedule) — without it, two instances would share
    // one topic and the second `.on()` call would throw ("cannot add
    // postgres_changes callbacks ... after subscribe()").
    const channel = supabase
      .channel(`doctor-online-${doctorProfileId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorProfileId}` },
        (payload) => {
          const newOnline = (payload.new as any)?.is_online
          if (typeof newOnline === 'boolean') setIsOnline(newOnline)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [doctorProfileId])

  // Re-sync from the DB when the app returns to the foreground — the
  // app-level background handler flips is_online false server-side when the
  // doctor backgrounds the app, so local state would otherwise show a stale
  // "Online" after resuming.
  useEffect(() => {
    if (!doctorProfileId || !opts?.resyncOnForeground) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then(async (token) => {
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('doctor_profiles')
          .select('is_online')
          .eq('id', doctorProfileId)
          .maybeSingle()
        if (data) setIsOnline(data.is_online ?? false)
      })
    })
    return () => sub.remove()
  }, [doctorProfileId, opts?.resyncOnForeground, getToken])

  const toggle = useCallback(async () => {
    if (!doctorProfileId || toggling) return
    setToggling(true)
    const newStatus = !isOnline
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const { error } = await getAuthClient(token)
        .from('doctor_profiles')
        .update({ is_online: newStatus })
        .eq('id', doctorProfileId)
      if (error) throw error
      setIsOnline(newStatus)
    } catch {
      Alert.alert('Connection Error', 'Could not update your online status. Please try again.')
    } finally {
      setToggling(false)
    }
  }, [doctorProfileId, toggling, isOnline, getToken])

  return { isOnline, setIsOnline, toggling, toggle }
}
