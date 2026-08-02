import { useCallback, useSyncExternalStore } from 'react'

import { Doctor } from '@/components/ui/DoctorCard'
import { formatDoctorName } from '@/lib/nameFormat'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { supabase } from '@/lib/supabase'

const DOCTORS_CACHE_KEY = 'patient-doctors-list'

function mapDoctor(d: any): Doctor {
  return {
    id: d.id,
    user_id: d.user_id,
    name: formatDoctorName(d.users?.full_name, 'Dr. Unknown'),
    subtitle: d.hospital_name ?? undefined,
    specialty: d.specialty ?? 'General',
    rating_average: Number(d.rating_average) ?? 0,
    review_count: d.review_count ?? 0,
    years_experience: d.years_experience ?? undefined,
    bio: d.bio ?? undefined,
    chat_price: Number(d.chat_price) ?? 0,
    phone_price: Number(d.phone_price) ?? 0,
    video_price: Number(d.video_price) ?? 0,
    is_online: d.is_online ?? false,
    last_seen_at: d.last_seen_at ?? null,
    last_seen_platform: d.last_seen_platform ?? null,
    profile_photo_url: d.users?.profile_photo_url ?? null,
    availability: d.availability ?? null,
    languages: d.languages ?? null,
    // The query this feeds always filters status='approved' server-side —
    // every doctor mapDoctor() ever sees is already approved.
    status: 'approved',
  }
}

interface StoreState {
  doctors: Doctor[]
  isLoading: boolean
  // Bumped every 30s (see PRESENCE_TICK_MS below) purely to force a new
  // `state` reference so useSyncExternalStore subscribers re-render and
  // recompute computeDoctorPresence() — a doctor's heartbeat going stale
  // produces no realtime event (silence isn't a DB write), so Away
  // transitions need a local timeout re-check, not just the is_online/
  // last_seen_at push events already handled below.
  presenceTick: number
}

// ─── Module-level singleton store ──────────────────────────────────────────
//
// Home's "Available Now"/"Top Rated" widgets and the Doctors tab's full list
// used to each run their own independent fetch of the exact same
// `doctor_profiles` rows plus their own unfiltered realtime subscription to
// `doctor_profiles`/`users` UPDATE events. Since both tab screens stay
// mounted for the life of the session (no unmountOnBlur), that meant every
// doctor going online/editing their profile fired the same handler twice,
// and every tab refocus re-issued a duplicate REST fetch on top of the
// other screen's own. This is public, not-per-patient data, so — unlike
// hooks/usePatientAppointments.ts — there is exactly one instance of it, not
// one per signed-in user.
let state: StoreState = { doctors: [], isLoading: true, presenceTick: 0 }
const listeners = new Set<() => void>()
let started = false
let consumerCount = 0
let teardownTimer: ReturnType<typeof setTimeout> | null = null
let inFlightRefresh: Promise<void> | null = null
let unsubscribeDoctorProfiles: (() => void) | null = null
let unsubscribeUsers: (() => void) | null = null
let presenceTickTimer: ReturnType<typeof setInterval> | null = null

const PRESENCE_TICK_MS = 30_000

// Realtime-derived fields always win over a REST fetch that resolves after
// the realtime event already landed — every fetch result is merged through
// this map before it reaches state.
const realtimeKnown = new Map<string, Partial<Doctor>>()

function emit() {
  listeners.forEach((l) => l())
}

// Coalesces bursts of same-turn patch() calls into a single emit(). Without
// this, useSyncExternalStore forces an immediate, unbatched re-render on
// every single emit() (its tearing-prevention design) — fine for one-off
// updates, but a bulk `doctor_profiles` UPDATE (e.g. the once-a-minute
// mark_stale_doctors_offline cron flipping many doctors offline in one
// statement) fans out to one realtime event per affected row, all delivered
// in the same JS turn by RN's bridge. Dozens of synchronous forced re-renders
// back-to-back with no chance to yield trips React's "Maximum update depth
// exceeded" guard even though nothing is actually looping.
let emitScheduled = false
function scheduleEmit() {
  if (emitScheduled) return
  emitScheduled = true
  queueMicrotask(() => {
    emitScheduled = false
    emit()
  })
}

function patch(next: Partial<StoreState>) {
  state = { ...state, ...next }
  scheduleEmit()
}

function mergeKnownRealtime(docs: Doctor[]): Doctor[] {
  return docs.map((d) => {
    const known = realtimeKnown.get(d.id)
    return known ? { ...d, ...known } : d
  })
}

function applyDoctorUpdate(list: Doctor[], doctorId: string, p: Partial<Doctor>): Doctor[] {
  return list.map((d) => (d.id === doctorId ? { ...d, ...p } : d))
}

function applyDoctorUpdateByUserId(list: Doctor[], userId: string, p: Partial<Doctor>): Doctor[] {
  return list.map((d) => (d.user_id === userId ? { ...d, ...p } : d))
}

async function refresh(): Promise<void> {
  if (inFlightRefresh) return inFlightRefresh
  inFlightRefresh = (async () => {
    try {
      const { data } = await supabase
        .from('doctor_profiles')
        .select('*, users!inner(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .order('rating_average', { ascending: false })
      if (data) {
        const doctors = mergeKnownRealtime(data.map(mapDoctor))
        patch({ doctors, isLoading: false })
        setCachedJson(DOCTORS_CACHE_KEY, doctors)
      } else {
        patch({ isLoading: false })
      }
    } catch {
      // Network failure — leave whatever list is already in state (cache or
      // a prior successful fetch) rather than throwing past this IIFE.
      patch({ isLoading: false })
    } finally {
      inFlightRefresh = null
    }
  })()
  return inFlightRefresh
}

function subscribeChannels() {
  unsubscribeDoctorProfiles = subscribeRealtime(
    'patient-doctors-doctor_profiles',
    [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles' }],
    (_event, payload) => {
      const updated = payload.new as any
      if (updated.status !== 'approved') return
      const p: Partial<Doctor> = {
        is_online: updated.is_online as boolean,
        last_seen_at: (updated.last_seen_at ?? null) as string | null,
        last_seen_platform: (updated.last_seen_platform ?? null) as string | null,
        languages: (updated.languages ?? undefined) as string[] | null | undefined,
        availability: (updated.availability ?? null) as Doctor['availability'],
        bio: (updated.bio ?? undefined) as string | undefined,
        specialty: (updated.specialty ?? 'General') as string,
        subtitle: (updated.hospital_name ?? undefined) as string | undefined,
        years_experience: (updated.years_experience ?? undefined) as number | undefined,
        chat_price: Number(updated.chat_price ?? 0),
        phone_price: Number(updated.phone_price ?? 0),
        video_price: Number(updated.video_price ?? 0),
        rating_average: Number(updated.rating_average ?? 0),
        review_count: (updated.review_count ?? 0) as number,
      }
      realtimeKnown.set(updated.id, { ...realtimeKnown.get(updated.id), ...p })
      patch({ doctors: applyDoctorUpdate(state.doctors, updated.id, p) })
    },
  )

  // A doctor editing their name/photo doesn't touch `doctor_profiles` at all.
  unsubscribeUsers = subscribeRealtime(
    'patient-doctors-users',
    [{ event: 'UPDATE', schema: 'public', table: 'users' }],
    (_event, payload) => {
      const updated = payload.new as any
      const doc = state.doctors.find((d) => d.user_id === updated.id)
      if (!doc) return
      const p: Partial<Doctor> = {
        name: formatDoctorName(updated.full_name, 'Dr. Unknown'),
        profile_photo_url: (updated.profile_photo_url ?? null) as string | null,
      }
      realtimeKnown.set(doc.id, { ...realtimeKnown.get(doc.id), ...p })
      patch({ doctors: applyDoctorUpdateByUserId(state.doctors, updated.id, p) })
    },
  )
}

function ensureStarted() {
  if (started) return
  started = true

  // Paint the last-known list immediately (memory/disk) so a cold start
  // shows real cards instead of a spinner-then-empty flash. Skipped if a
  // real fetch has already resolved by the time this settles.
  getCachedJson<Doctor[]>(DOCTORS_CACHE_KEY).then((cached) => {
    if (!started || !cached || !state.isLoading) return
    patch({ doctors: cached })
  })

  ;(async () => {
    // Fetch first, subscribe after — joining the realtime channel
    // concurrently with this REST fetch lets UPDATE events land in the
    // join-latency window (silently dropped, never queued/redelivered), and
    // lets this fetch's result clobber realtime state that already landed.
    await refresh()
    if (!started) return
    subscribeChannels()
  })()

  presenceTickTimer = setInterval(() => {
    patch({ presenceTick: state.presenceTick + 1 })
  }, PRESENCE_TICK_MS)
}

function subscribeStore(listener: () => void) {
  consumerCount++
  if (teardownTimer) {
    clearTimeout(teardownTimer)
    teardownTimer = null
  }
  listeners.add(listener)
  ensureStarted()
  return () => {
    listeners.delete(listener)
    consumerCount--
    if (consumerCount > 0) return
    // Grace period (not synchronous teardown) so a same-tick unmount+remount
    // of the last consumer reuses the live store instead of racing a full
    // reset — mirrors lib/realtimeChannelManager.ts's own teardown grace
    // period. `state`/cache are deliberately left as last-known-good so a
    // later re-mount paints instantly instead of flashing loading/empty.
    teardownTimer = setTimeout(() => {
      if (consumerCount > 0) return
      unsubscribeDoctorProfiles?.()
      unsubscribeUsers?.()
      unsubscribeDoctorProfiles = null
      unsubscribeUsers = null
      if (presenceTickTimer) {
        clearInterval(presenceTickTimer)
        presenceTickTimer = null
      }
      started = false
    }, 0)
  }
}

function getSnapshot() {
  return state
}

/**
 * Single source of truth for the approved doctor list — used by both the
 * Home screen's "Available Now"/"Top Rated" widgets and the Doctors tab's
 * full list, so they can never show temporarily inconsistent data and never
 * open more than one realtime subscription per table between them.
 */
export function usePatientDoctors() {
  const snapshot = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot)

  const refreshNow = useCallback(() => refresh(), [])

  return {
    doctors: snapshot.doctors,
    isLoading: snapshot.isLoading,
    // Exposed so callers that memoize/derive from `doctors` (whose array
    // reference is intentionally stable across a presence-only tick) can
    // still force a recompute — e.g. FlatList's `extraData`, or as a
    // useMemo dependency for a presence-based sort. See StoreState above.
    presenceTick: snapshot.presenceTick,
    refresh: refreshNow,
  }
}
