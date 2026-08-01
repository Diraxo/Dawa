import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useRef } from 'react'

import { getAuthClient } from '@/lib/supabase'

const INTERVAL_MS = 60_000

/**
 * Touches doctor_profiles.last_seen_at every 60s while the doctor is online
 * — migration 042 added this column for a server-side stale-doctor sweep,
 * but migration 060 removed that sweep (and every other auto-offline
 * mechanism) as a deliberate product decision: is_online must never change
 * except via an explicit Go Offline action. That migration never left a
 * writer behind, so last_seen_at has been frozen/NULL ever since, silently
 * breaking the "recently online" doctor sort (patient home, carehub-web
 * patient page). This only ever writes a timestamp — it must never read
 * back is_online or flip it, so it cannot reintroduce any auto-offline
 * behavior.
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
        const token = await getToken()
        if (!token || !doctorProfileId) return
        await getAuthClient(token)
          .from('doctor_profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', doctorProfileId)
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
