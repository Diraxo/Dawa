import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export interface DoctorLiveFields {
  is_online: boolean
  languages: string[] | null
  availability: Record<string, unknown> | null
  bio: string | null
  specialty: string | null
  hospital_name: string | null
  years_experience: number | null
  chat_price: number
  phone_price: number
  video_price: number
}

/**
 * Subscribes to Realtime UPDATEs on doctor_profiles and invokes `onUpdate`
 * with (doctorId, fields) for every change, so patient-facing pages stay
 * live without a manual refresh — mirroring the existing mobile pattern in
 * app/(patient)/(tabs)/home.tsx and app/(patient)/(tabs)/doctors.tsx.
 *
 * Two races this hook guards against:
 *
 * 1. Join-latency drop — the channel takes time to reach SUBSCRIBED
 *    (WebSocket handshake + Clerk-token realtime auth). Any UPDATE that
 *    fires before SUBSCRIBED is silently lost — postgres_changes never
 *    redelivers it. `onReady` fires exactly once, when the channel reaches
 *    SUBSCRIBED, so a consumer can re-run its initial fetch at that point to
 *    reconcile anything missed during the join window.
 * 2. Stale-fetch overwrite — a REST response (initial fetch or the
 *    reconciliation re-fetch above) can resolve *after* a realtime event
 *    already applied, and would otherwise blindly revert state to stale
 *    data. Call `reconcile(row)` on every fetched row before applying it to
 *    state — it merges in the freshest realtime-derived values for that
 *    doctor, if any arrived after the fetch was issued.
 *
 * Pass a stable callback (e.g. wrapped in useCallback, or accept the
 * re-subscribe — cheap since it's just one channel per mount).
 */
export function useDoctorOnlineStatus(
  onUpdate: (doctorId: string, fields: DoctorLiveFields) => void,
  onReady?: () => void
) {
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // Freshest realtime-derived values per doctor, keyed by id. Lets
  // `reconcile` refuse to let an in-flight REST fetch clobber a value that
  // arrived live after the fetch was issued (but before it resolved).
  const liveRef = useRef<Map<string, DoctorLiveFields>>(new Map())

  useEffect(() => {
    liveRef.current = new Map()

    const channel = supabase
      .channel('patient-doctor-online-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
        (payload) => {
          const updated = payload.new as {
            id: string
            is_online: boolean
            languages: string[] | null
            availability: Record<string, unknown> | null
            bio: string | null
            specialty: string | null
            hospital_name: string | null
            years_experience: number | null
            chat_price: number | null
            phone_price: number | null
            video_price: number | null
          }
          const fields: DoctorLiveFields = {
            is_online: updated.is_online,
            languages: updated.languages ?? null,
            availability: updated.availability ?? null,
            bio: updated.bio ?? null,
            specialty: updated.specialty ?? null,
            hospital_name: updated.hospital_name ?? null,
            years_experience: updated.years_experience ?? null,
            chat_price: Number(updated.chat_price ?? 0),
            phone_price: Number(updated.phone_price ?? 0),
            video_price: Number(updated.video_price ?? 0),
          }
          liveRef.current.set(updated.id, fields)
          onUpdateRef.current(updated.id, fields)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onReadyRef.current?.()
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Merge a freshly-fetched row against any newer realtime value already
  // known for that doctor. Consumers should call this on every row coming
  // back from a REST fetch (initial or reconciliation) before applying it to
  // state, so a slow/racing fetch response can never revert a live update.
  function reconcile<
    T extends {
      id: string; is_online: boolean; languages?: string[] | null; availability?: Record<string, unknown> | null
      bio?: string | null; specialty?: string | null; hospital_name?: string | null; years_experience?: number | null
      chat_price?: number; phone_price?: number; video_price?: number
    }
  >(row: T): T {
    const live = liveRef.current.get(row.id)
    if (!live) return row
    return {
      ...row,
      is_online: live.is_online,
      ...('languages' in row ? { languages: live.languages } : {}),
      ...('availability' in row ? { availability: live.availability } : {}),
      ...('bio' in row ? { bio: live.bio } : {}),
      ...('specialty' in row ? { specialty: live.specialty } : {}),
      ...('hospital_name' in row ? { hospital_name: live.hospital_name } : {}),
      ...('years_experience' in row ? { years_experience: live.years_experience } : {}),
      ...('chat_price' in row ? { chat_price: live.chat_price } : {}),
      ...('phone_price' in row ? { phone_price: live.phone_price } : {}),
      ...('video_price' in row ? { video_price: live.video_price } : {}),
    }
  }

  return { reconcile }
}
