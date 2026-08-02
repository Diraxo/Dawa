import { useAuth } from '@clerk/clerk-expo'
import { useCallback, useEffect, useState } from 'react'
import { Alert, AppState } from 'react-native'

import { getAuthClient, supabase } from '@/lib/supabase'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { callkeep } from '@/lib/callkeep'

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
    // Shared, ref-counted channel: this hook mounts on multiple sibling tabs
    // at once (Home, Schedule) but they all reuse one subscription for this
    // doctor's row instead of opening a duplicate each.
    return subscribeRealtime(
      `doctor_profiles:id=eq.${doctorProfileId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorProfileId}` }],
      (_event, payload) => {
        const newOnline = (payload.new as any)?.is_online
        if (typeof newOnline === 'boolean') setIsOnline(newOnline)
      },
    )
  }, [doctorProfileId])

  // Re-sync from the DB when the app returns to the foreground — is_online
  // can change from another session (web, another device) while this one was
  // backgrounded, so local state would otherwise show a stale value after
  // resuming. Nothing in this app auto-flips is_online; see
  // hooks/useDoctorPresenceHeartbeat.ts for the separate, non-authoritative
  // Away/presence signal that layers on top of this toggle instead.
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

      // Going online is the doctor opting in to receive incoming calls right
      // now — re-verify Android's ConnectionService PhoneAccount here too
      // (not just at app start) so a doctor who enabled it, then went
      // offline, then disabled it again before coming back online is caught
      // before their first request ever arrives. No-op on iOS/web and
      // when going offline.
      if (newStatus) callkeep.ensurePhoneAccountEnabled()
    } catch {
      Alert.alert('Connection Error', 'Could not update your online status. Please try again.')
    } finally {
      setToggling(false)
    }
  }, [doctorProfileId, toggling, isOnline, getToken])

  return { isOnline, setIsOnline, toggling, toggle }
}
