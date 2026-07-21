import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type PostgresChangesEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

export interface RealtimeChangeFilter {
  event: PostgresChangesEvent
  schema: string
  table: string
  filter?: string
}

export type RealtimeChangeCallback = (
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
) => void

interface SharedEntry {
  channel: ReturnType<typeof supabase.channel>
  callbacks: Map<symbol, RealtimeChangeCallback>
  removalTimer: ReturnType<typeof setTimeout> | null
}

const registry = new Map<string, SharedEntry>()

/**
 * Ref-counted Supabase Realtime channel shared by every consumer of the same
 * logical `topic` (one entity/table row — e.g. `users:id=eq.<id>`). The first
 * subscriber creates the channel and registers `filters` with `.on()`; every
 * later subscriber for the same topic just adds a callback to the channel's
 * dispatch list, so `.on()` is never called a second time after `subscribe()`
 * — the actual cause of the old "cannot add postgres_changes callbacks ...
 * after subscribe()" error. That error used to be worked around by suffixing
 * each mount's channel name with `Date.now()`, which meant every mounted
 * screen opened its own duplicate network subscription instead of sharing
 * one. Do not reintroduce that pattern — register a new consumer here
 * instead of creating a parallel `supabase.channel()` call.
 *
 * Callers subscribing to the same `topic` must pass equivalent `filters` —
 * only the first caller's filters are actually registered; later calls just
 * attach a callback to what's already there.
 *
 * The channel is torn down after a 0ms grace period once the last consumer
 * unsubscribes (not synchronously), so a same-tick unmount+remount of the
 * same topic (React StrictMode's double-invoke, or a fast re-navigation)
 * reuses the still-live channel instead of racing `removeChannel()`'s async
 * unsubscribe against a fresh `supabase.channel()` call for the same topic
 * (which — since `RealtimeClient.channel()` returns any existing channel
 * object still in its internal list before teardown completes — would hand
 * back the old, already-subscribed channel and make `.on()` throw).
 */
export function subscribeRealtime(
  topic: string,
  filters: RealtimeChangeFilter[],
  callback: RealtimeChangeCallback,
): () => void {
  const id = Symbol('realtime-consumer')
  let entry = registry.get(topic)

  if (entry?.removalTimer) {
    clearTimeout(entry.removalTimer)
    entry.removalTimer = null
  }

  if (!entry) {
    const callbacks = new Map<symbol, RealtimeChangeCallback>()
    let builder = supabase.channel(topic)
    for (const f of filters) {
      builder = builder.on(
        'postgres_changes',
        { event: f.event, schema: f.schema, table: f.table, filter: f.filter } as never,
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callbacks.forEach((cb) => cb(payload.eventType, payload))
        },
      )
    }
    builder.subscribe()
    entry = { channel: builder, callbacks, removalTimer: null }
    registry.set(topic, entry)
  }

  entry.callbacks.set(id, callback)

  return function unsubscribe() {
    const current = registry.get(topic)
    if (!current) return
    current.callbacks.delete(id)
    if (current.callbacks.size > 0) return
    current.removalTimer = setTimeout(() => {
      const latest = registry.get(topic)
      if (!latest || latest.callbacks.size > 0) return
      registry.delete(topic)
      supabase.removeChannel(latest.channel)
    }, 0)
  }
}

/** Test/debug helper — active shared topics and their consumer counts. */
export function getSharedRealtimeStats(): { topic: string; consumers: number }[] {
  return Array.from(registry.entries()).map(([topic, e]) => ({ topic, consumers: e.callbacks.size }))
}
