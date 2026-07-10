'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

const INTERVAL_MS = 30_000 // 30 seconds — well within the 10-minute stale threshold

/**
 * Sends a heartbeat UPDATE to consultations.last_heartbeat_at every 30 seconds
 * while the consultation is in an active state.
 *
 * Pass `active=false` to pause the heartbeat (e.g. when call ends or chat closes).
 */
export function useHeartbeat(consultationId: string | undefined, active: boolean) {
  const { getToken } = useAuth()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const consecutiveFailuresRef = useRef(0)

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
        if (!token || !consultationId) {
          logger.error(`[Heartbeat][${Date.now()}] ping skipped — no Clerk token`)
          return
        }
        const { data, error } = await getAuthClient(token)
          .from('consultations')
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq('id', consultationId)
          .in('status', ['accepted', 'in_progress', 'active'])
          .select('id')
        if (error) {
          consecutiveFailuresRef.current += 1
          logger.error(`[Heartbeat][${Date.now()}] ping failed (consecutive:${consecutiveFailuresRef.current}):`, error)
        } else if (!data || data.length === 0) {
          // Row didn't match accepted/in_progress/active — most likely the
          // call already ended. Not logged as an error since this is the
          // expected steady-state once the call is over and the interval
          // just hasn't been torn down yet.
          logger.log(`[Heartbeat][${Date.now()}] ping matched 0 rows — consultation no longer active`)
        } else {
          // A stale-session cron (mark_stale_active_consultations, 10 min
          // without a heartbeat) is watching this column server-side — if
          // pings start failing, that cron is the thing that will silently
          // end this call, so surface the failure count here rather than
          // swallowing it.
          if (consecutiveFailuresRef.current > 0) {
            logger.log(`[Heartbeat][${Date.now()}] ping recovered after ${consecutiveFailuresRef.current} failure(s)`)
          }
          consecutiveFailuresRef.current = 0
        }
      } catch (err) {
        consecutiveFailuresRef.current += 1
        logger.error(`[Heartbeat][${Date.now()}] ping threw (consecutive:${consecutiveFailuresRef.current}):`, err)
      }
    }

    // Immediate ping so the first heartbeat lands within 1 second of joining
    ping()
    intervalRef.current = setInterval(ping, INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, active])
}
