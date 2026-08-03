import { useAuth, useUser } from '@clerk/clerk-expo'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import { formatDoctorName } from '@/lib/nameFormat'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { getAuthClient } from '@/lib/supabase'

export type ConsultationType = 'chat' | 'phone' | 'video'

export interface PatientAppointment {
  id: string
  doctorId: string
  doctorUserId: string
  doctorName: string
  doctorSpecialty: string
  doctorHospital: string
  doctorIsOnline: boolean
  doctorPhotoUrl: string | null
  doctorStatus: string | null
  type: ConsultationType
  scheduledAt: string
  startedAt: string | null
  createdAt: string
  status: string
  paymentStatus: string | null
  amount: number
  isOnDemand: boolean
}

export interface FollowupReminder {
  id: string
  remind_at: string
  message: string | null
  consultation_id: string
}

interface StoreState {
  upcoming: PatientAppointment[]
  past: PatientAppointment[]
  reminders: FollowupReminder[]
  isLoading: boolean
}

const CONSULTATIONS_SELECT = `
  id, type, status, payment_status, scheduled_at, started_at, created_at, patient_amount,
  doctor_profiles!inner(id, specialty, hospital_name, is_online, status, users!inner(id, full_name, profile_photo_url))
`

// On-demand bookings set scheduled_at = new Date() which has non-zero seconds.
// Scheduled slot times are always parsed as HH:MM:00 (zero seconds).
function isOnDemandRow(row: any): boolean {
  if (!row.scheduled_at) return true
  const s = new Date(row.scheduled_at)
  return s.getSeconds() !== 0 || s.getMilliseconds() !== 0
}

function mapRow(row: any): PatientAppointment {
  const dp = row.doctor_profiles as any
  return {
    id: row.id,
    doctorId: dp?.id ?? '',
    doctorUserId: dp?.users?.id ?? '',
    doctorName: formatDoctorName(dp?.users?.full_name, 'Doctor'),
    doctorSpecialty: dp?.specialty ?? 'General',
    doctorHospital: dp?.hospital_name ?? '',
    doctorIsOnline: dp?.is_online ?? false,
    doctorPhotoUrl: dp?.users?.profile_photo_url ?? null,
    doctorStatus: dp?.status ?? null,
    type: (row.type ?? 'chat') as ConsultationType,
    scheduledAt: row.scheduled_at ?? row.created_at ?? new Date().toISOString(),
    startedAt: row.started_at ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
    status: row.status ?? 'pending',
    paymentStatus: row.payment_status ?? null,
    amount: Number(row.patient_amount) || 0,
    isOnDemand: isOnDemandRow(row),
  }
}

// Single canonical classification, shared by every screen that shows
// appointments — previously the Home widget and Appointments tab each
// hand-rolled their own status list (and had quietly drifted apart: Home
// never considered a paid, not-yet-activated 'pending' booking "upcoming",
// while the Appointments tab did). One function means the two screens are
// structurally unable to disagree about what counts as upcoming vs past.
function classify(rows: any[]): { upcoming: PatientAppointment[]; past: PatientAppointment[] } {
  const now = new Date()

  const upcomingRows = rows.filter((r) => {
    if (r.status === 'active') return true
    if (r.status === 'scheduled') return true
    // The doctor has accepted (or the call is already underway) but the
    // patient hasn't navigated in yet.
    if (r.status === 'accepted' || r.status === 'in_progress') return true
    // The server-time cron activated a scheduled booking but the doctor
    // hasn't accepted yet — still "upcoming", not gone.
    if (r.status === 'waiting_for_doctor' && !isOnDemandRow(r)) return true
    if (r.status === 'pending' && r.payment_status === 'paid' && !isOnDemandRow(r)) {
      return new Date(r.scheduled_at) > now
    }
    return false
  })

  const pastRows = rows.filter((r) => {
    if (r.status === 'completed') return true
    // Payment-failure cancellations have payment_status='pending' — hide those.
    if (r.status === 'cancelled' && r.payment_status === 'paid') return true
    if (r.status === 'pending' && r.payment_status === 'paid' && !isOnDemandRow(r)) {
      return new Date(r.scheduled_at) <= now
    }
    return false
  })

  const upcoming = upcomingRows
    .map(mapRow)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const past = pastRows.map(mapRow)

  return { upcoming, past }
}

// ─── Module-level singleton store ──────────────────────────────────────────
//
// Home's Upcoming Appointment widget and the Appointments > Upcoming/Past
// tabs used to each run their own independent fetch + realtime subscription.
// That let them show temporarily different data, and each screen's own
// `useFocusEffect`/`useEffect` dependency array (which included Clerk's
// `getToken` and, transitively via `loadAppointments`, react-i18next's `t`)
// could change identity shortly after app start (e.g. the language-restore
// effect in app/_layout.tsx calling `i18n.changeLanguage` once AsyncStorage
// resolves) and silently retrigger the whole fetch/subscribe cycle,
// resetting the loading flag back to `true` — the loading → empty → loading
// → settle flicker. Centralizing state here means every consumer reads the
// exact same in-flight data, there is exactly one realtime subscription per
// table, and `isLoading` is only ever true before the first fetch for the
// current user has ever resolved.

let state: StoreState = { upcoming: [], past: [], reminders: [], isLoading: true }
const listeners = new Set<() => void>()
let ownerClerkId: string | null = null
let patientId: string | null = null
let consumerCount = 0
let teardownTimer: ReturnType<typeof setTimeout> | null = null
let initGeneration = 0
let inFlightRefresh: Promise<void> | null = null
let unsubscribeConsultations: (() => void) | null = null
let unsubscribeUsers: (() => void) | null = null
let unsubscribeDoctorProfiles: (() => void) | null = null

function emit() {
  listeners.forEach((l) => l())
}

// Coalesces bursts of same-turn patch() calls into a single emit() — see
// hooks/usePatientDoctors.ts's identical helper for why: useSyncExternalStore
// forces an immediate, unbatched re-render per emit(), and a burst of
// same-turn realtime events (RN's bridge can deliver several queued
// WebSocket messages within one JS turn) would otherwise fire that many
// synchronous re-renders back-to-back, tripping React's "Maximum update
// depth exceeded" guard even though nothing is actually looping.
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

function cacheKeys(clerkId: string) {
  return {
    upcoming: `patient-appt-upcoming:${clerkId}`,
    past: `patient-appt-past:${clerkId}`,
  }
}

function teardownRealtime() {
  unsubscribeConsultations?.()
  unsubscribeUsers?.()
  unsubscribeDoctorProfiles?.()
  unsubscribeConsultations = null
  unsubscribeUsers = null
  unsubscribeDoctorProfiles = null
}

async function refresh(getToken: () => Promise<string | null>): Promise<void> {
  if (!patientId) return
  if (inFlightRefresh) return inFlightRefresh

  const myPatientId = patientId
  inFlightRefresh = (async () => {
    try {
      const token = await getToken()
      if (!token || patientId !== myPatientId) return
      const client = getAuthClient(token)
      const [{ data }, { data: reminderData }] = await Promise.all([
        client
          .from('consultations')
          .select(CONSULTATIONS_SELECT)
          .eq('patient_id', myPatientId)
          .order('scheduled_at', { ascending: false }),
        client
          .from('followup_reminders')
          .select('id, remind_at, message, consultation_id')
          .eq('patient_id', myPatientId)
          .eq('sent', false)
          .gte('remind_at', new Date().toISOString())
          .order('remind_at', { ascending: true })
          .limit(3),
      ])
      if (patientId !== myPatientId) return

      if (data) {
        const { upcoming, past } = classify(data)
        patch({ upcoming, past, reminders: (reminderData as FollowupReminder[]) ?? [], isLoading: false })
        if (ownerClerkId) {
          const keys = cacheKeys(ownerClerkId)
          setCachedJson(keys.upcoming, upcoming)
          setCachedJson(keys.past, past)
        }
      } else {
        patch({ isLoading: false })
      }
    } catch {
      patch({ isLoading: false })
    } finally {
      inFlightRefresh = null
    }
  })()
  return inFlightRefresh
}

function subscribeChannels(getToken: () => Promise<string | null>) {
  if (!patientId) return
  const pid = patientId

  unsubscribeConsultations = subscribeRealtime(
    `patient-appointments-consultations-${pid}`,
    [{ event: '*', schema: 'public', table: 'consultations', filter: `patient_id=eq.${pid}` }],
    () => {
      refresh(getToken)
    },
  )

  // A doctor editing their name/photo doesn't touch `consultations` at all.
  unsubscribeUsers = subscribeRealtime(
    `patient-appointments-doctor-users-${pid}`,
    [{ event: 'UPDATE', schema: 'public', table: 'users' }],
    (_event, payload) => {
      const updated = payload.new as any
      const isMyDoctor =
        state.upcoming.some((a) => a.doctorUserId === updated.id) ||
        state.past.some((a) => a.doctorUserId === updated.id)
      if (isMyDoctor) refresh(getToken)
    },
  )

  // Same gap as above but for doctor_profiles fields (is_online, specialty, hospital_name).
  unsubscribeDoctorProfiles = subscribeRealtime(
    `patient-appointments-doctor-profiles-${pid}`,
    [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles' }],
    (_event, payload) => {
      const updated = payload.new as any
      const isMyDoctor =
        state.upcoming.some((a) => a.doctorId === updated.id) ||
        state.past.some((a) => a.doctorId === updated.id)
      if (isMyDoctor) refresh(getToken)
    },
  )
}

function ensureInitialized(clerkUserId: string, getToken: () => Promise<string | null>) {
  if (ownerClerkId === clerkUserId) return // already initialized/initializing for this user
  ownerClerkId = clerkUserId
  patientId = null
  teardownRealtime()
  state = { upcoming: [], past: [], reminders: [], isLoading: true }
  emit()

  const myGeneration = ++initGeneration
  const keys = cacheKeys(clerkUserId)

  // Paint the last-known lists immediately (memory/disk) so a cold start
  // shows real data instead of a spinner-then-empty flash — never touches
  // `isLoading`, which stays gated on the real fetch below.
  getCachedJson<PatientAppointment[]>(keys.upcoming).then((cached) => {
    if (myGeneration !== initGeneration || !cached) return
    patch({ upcoming: cached })
  })
  getCachedJson<PatientAppointment[]>(keys.past).then((cached) => {
    if (myGeneration !== initGeneration || !cached) return
    patch({ past: cached })
  })

  ;(async () => {
    try {
      const token = await getToken()
      if (myGeneration !== initGeneration) return
      if (!token) { patch({ isLoading: false }); return }
      const client = getAuthClient(token)
      const { data: me } = await client.from('users').select('id').eq('clerk_id', clerkUserId).maybeSingle()
      if (myGeneration !== initGeneration) return
      if (!me) { patch({ isLoading: false }); return }

      patientId = (me as any).id
      await refresh(getToken)
      if (myGeneration !== initGeneration) return
      subscribeChannels(getToken)
    } catch {
      if (myGeneration === initGeneration) patch({ isLoading: false })
    }
  })()
}

function getSnapshot() {
  return state
}

function subscribeStore(listener: () => void) {
  consumerCount++
  if (teardownTimer) {
    clearTimeout(teardownTimer)
    teardownTimer = null
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    consumerCount--
    if (consumerCount > 0) return
    // Grace period (not synchronous teardown) so a same-tick unmount+remount
    // of the last consumer (screen transition, React StrictMode double-
    // invoke) reuses the live store instead of racing a full reset — mirrors
    // lib/realtimeChannelManager.ts's own channel-teardown grace period.
    teardownTimer = setTimeout(() => {
      if (consumerCount > 0) return
      teardownRealtime()
      ownerClerkId = null
      patientId = null
      initGeneration++
      state = { upcoming: [], past: [], reminders: [], isLoading: true }
    }, 0)
  }
}

/**
 * Single source of truth for the signed-in patient's appointments — used by
 * both the Home "Upcoming Appointment" widget and the Appointments screen's
 * Upcoming/Past tabs, so they can never show temporarily inconsistent data.
 * `isLoading` is true only until the first fetch for the current user
 * resolves; realtime-triggered/background refreshes never reset it.
 */
export function usePatientAppointments() {
  const { user } = useUser()
  const { getToken } = useAuth()

  // Kept current via a ref (never an effect dependency) — Clerk's `getToken`
  // is not guaranteed referentially stable across renders, and including it
  // in a dependency array is exactly what previously caused the whole fetch
  // cycle to tear down and restart (resetting the loading flag) whenever it
  // changed identity for reasons unrelated to the signed-in user actually
  // changing.
  const getTokenRef = useRef(getToken)
  useEffect(() => { getTokenRef.current = getToken }, [getToken])

  const snapshot = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!user?.id) return
    ensureInitialized(user.id, () => getTokenRef.current())
  }, [user?.id])

  const refreshNow = useCallback(() => {
    if (!user?.id) return Promise.resolve()
    return refresh(() => getTokenRef.current())
  }, [user?.id])

  return {
    upcoming: snapshot.upcoming,
    past: snapshot.past,
    reminders: snapshot.reminders,
    isLoading: snapshot.isLoading,
    refresh: refreshNow,
  }
}
