import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Corrects for device clocks that can't be trusted (unset, misconfigured,
// or deliberately turned back to keep an already-past booking slot looking
// bookable) by anchoring "now" to Postgres' own now() — via the
// get_server_time() RPC (migration 082) — instead of the device's
// Date.now(). Once synced, the device clock is only used as a monotonic
// ticker between syncs; its absolute value never leaks into slot-
// availability math on its own. Mirrors carehub-web/lib/serverClock.ts.
let cachedOffsetMs: number | null = null

async function fetchOffsetMs(): Promise<number> {
  const requestedAt = Date.now()
  const { data, error } = await supabase.rpc('get_server_time')
  const respondedAt = Date.now()
  if (error || !data) throw error ?? new Error('get_server_time returned no data')
  const serverMs = new Date(data as string).getTime()
  // Cheap NTP-style correction: assume the server generated its timestamp
  // roughly halfway through this round trip.
  const roundTripMs = respondedAt - requestedAt
  return serverMs + roundTripMs / 2 - respondedAt
}

// Returns a device-clock-independent "now" (ms since epoch), re-synced with
// Postgres on mount and every 5 minutes after (guards against drift over a
// long-open booking screen), ticking locally every `intervalMs` in between
// so a slot that just lapsed disappears within that window without the
// patient touching anything.
export function useServerNow(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now() + (cachedOffsetMs ?? 0))

  useEffect(() => {
    let cancelled = false

    async function sync() {
      try {
        const offset = await fetchOffsetMs()
        if (cancelled) return
        cachedOffsetMs = offset
        setNowMs(Date.now() + offset)
      } catch {
        // Sync failed (offline, RPC unreachable) — keep ticking on whatever
        // offset (possibly none yet) is already cached rather than blocking.
        if (!cancelled) setNowMs(Date.now() + (cachedOffsetMs ?? 0))
      }
    }

    sync()
    const syncId = setInterval(sync, 5 * 60_000)
    const tickId = setInterval(() => setNowMs(Date.now() + (cachedOffsetMs ?? 0)), intervalMs)
    return () => { cancelled = true; clearInterval(syncId); clearInterval(tickId) }
  }, [intervalMs])

  return nowMs
}
