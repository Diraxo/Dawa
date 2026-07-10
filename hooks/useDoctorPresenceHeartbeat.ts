import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-expo'
import { getAuthClient } from '@/lib/supabase'

const INTERVAL_MS = 60_000 // 60 seconds — well within the 2-minute stale threshold

/**
 * Sends a heartbeat UPDATE to doctor_profiles.last_seen_at every 60 seconds
 * while the doctor is toggled online, so the server-side
 * mark_stale_doctors_offline() cleanup can tell a crashed/force-quit app
 * apart from one still genuinely online.
 *
 * Must only run while is_online is true. Pass `active=false` when toggled off.
 */
export function useDoctorPresenceHeartbeat(doctorProfileId: string | undefined, active: boolean) {
  const { getToken } = useAuth()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active || !doctorProfileId) {
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
  // doctorProfileId and active are the only meaningful dependencies
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorProfileId, active])
}
