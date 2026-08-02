import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { getAuthClient } from '@/lib/supabase'
import { getOrCreateDeviceId } from '@/lib/deviceId'

const INTERVAL_MS = 30_000

/**
 * Calls update_doctor_heartbeat() every 30s while the doctor is online —
 * migration 113 turns this into the input for server-side Away detection
 * (get_doctor_presence()): is_online stays the doctor's own explicit
 * preference and is never auto-flipped, but a doctor whose heartbeat goes
 * stale for 2+ minutes now reads as 'away' to patients and is blocked from
 * new On-Demand bookings, without ever touching is_online itself. The write
 * goes through a SECURITY DEFINER RPC (not a direct table update) so
 * last_seen_at is always server time — a client-supplied timestamp could
 * otherwise be used to fake perpetual availability, defeating the point.
 * Tagged with platform='mobile' so this staleness rule only ever applies to
 * doctors who have used the app — carehub-web has no equivalent writer, so a
 * web-only doctor's last_seen_platform stays null and their presence keeps
 * resolving exactly as before this migration.
 */
export function useDoctorPresenceHeartbeat(doctorProfileId: string | null, isOnline: boolean) {
  const { getToken } = useAuth()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isOnline || !doctorProfileId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    async function ping() {
      try {
        const [token, deviceId] = await Promise.all([getToken(), getOrCreateDeviceId()])
        if (!token || !doctorProfileId) return
        await getAuthClient(token).rpc('update_doctor_heartbeat', {
          p_device: deviceId,
          p_platform: Platform.OS,
        })
      } catch {
        // Network failure — next tick will retry. Do not throw.
      }
    }

    ping()
    intervalRef.current = setInterval(ping, INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [doctorProfileId, isOnline, getToken])
}
