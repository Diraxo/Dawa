import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-expo'
import { getAuthClient } from '@/lib/supabase'

const INTERVAL_MS = 30_000 // 30 seconds — well within the 10-minute stale threshold

/**
 * Sends a heartbeat UPDATE to consultations.last_heartbeat_at every 30 seconds
 * while the consultation is in an active state.
 *
 * Must only run while the local user is actively in the session (connected,
 * in_progress, etc.). Pass `active=false` to pause when the session ends.
 */
export function useHeartbeat(consultationId: string | undefined, active: boolean) {
  const { getToken } = useAuth()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active || !consultationId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    async function ping() {
      try {
        const token = await getToken()
        if (!token || !consultationId) return
        await getAuthClient(token)
          .from('consultations')
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq('id', consultationId)
          .in('status', ['accepted', 'in_progress', 'active'])
      } catch {
        // Network failure — next tick will retry. Do not throw.
      }
    }

    // Immediate ping so we register within the first second of joining
    ping()
    intervalRef.current = setInterval(ping, INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  // consultationId and active are the only meaningful dependencies
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, active])
}
