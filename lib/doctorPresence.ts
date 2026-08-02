// lib/doctorPresence.ts
//
// Display-only mirror of get_doctor_presence() (migration 113). The server
// function is the authoritative gate for On-Demand booking (checked inside
// book_appointment_slot()); this pure function only drives what a patient
// screen shows between polls/realtime events, using whatever is_online/
// last_seen_at/last_seen_platform it already has locally. Deliberately
// excludes 'busy' — that state is only surfaced inside BookingModal, which
// polls is_doctor_busy() directly (see components/ui/BookingModal.tsx).

export type DoctorPresence = 'available' | 'away' | 'offline'

const AWAY_THRESHOLD_MS = 2 * 60 * 1000

export function computeDoctorPresence(doctor: {
  is_online?: boolean | null
  last_seen_at?: string | null
  last_seen_platform?: string | null
}): DoctorPresence {
  if (!doctor.is_online) return 'offline'

  if (doctor.last_seen_platform === 'mobile') {
    if (!doctor.last_seen_at) return 'away'
    const age = Date.now() - new Date(doctor.last_seen_at).getTime()
    if (age > AWAY_THRESHOLD_MS) return 'away'
  }

  return 'available'
}
