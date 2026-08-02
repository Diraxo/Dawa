import { create } from 'zustand'

interface ConsultationPresenceState {
  // Best-effort cache of whether this signed-in user currently has an active
  // (waiting_for_doctor/accepted/in_progress/active) consultation, mirroring
  // the last result useActiveConsultationRecovery's DB check resolved. The
  // DB check remains the source of truth and keeps this in sync on every
  // segment change/foreground/reconnect — this cache exists purely so the
  // (tabs) layouts can block their first render synchronously (no network
  // round trip) instead of letting Home/Messages/Appointments/Profile flash
  // on screen for the DB check's duration whenever a notification tap or
  // deep link lands the user on a tab route while a consultation is still
  // active elsewhere (see useConsultationBackGuard.ts for the equivalent
  // protection on the consultation screen's own exit paths).
  // Deliberately not persisted — stale across a fresh app process would be
  // worse than starting at false and letting the DB check correct it.
  hasActiveConsultation: boolean
  setHasActiveConsultation: (v: boolean) => void

  // Set the moment the user confirms "Leave" on a chat/phone/video
  // consultation that stays active without them (doctor/patient can walk
  // away while the other continues — see the "Leave Call"/"Leave
  // Consultation?" copy in the six consultation screens). Without this,
  // useActiveConsultationRecovery re-detects that same still-in_progress
  // consultation on the very next tab landed on and silently routes the
  // user straight back into the screen they just deliberately left,
  // defeating the leave action entirely. Cleared the moment they
  // voluntarily re-enter that consultation's own screen again, which
  // re-arms recovery for any *involuntary* loss (crash, kill, dropped
  // connection) from that point on. Deliberately not persisted — a fresh
  // app process has no memory of a same-session choice, and cold-launch
  // reconnection into a still-active consultation is deliberate existing
  // behavior (see splash.tsx).
  voluntarilyLeftConsultationId: string | null
  setVoluntarilyLeftConsultationId: (id: string | null) => void
}

export const useConsultationPresenceStore = create<ConsultationPresenceState>()((set) => ({
  hasActiveConsultation: false,
  setHasActiveConsultation: (v) => set((s) => (s.hasActiveConsultation === v ? s : { hasActiveConsultation: v })),
  voluntarilyLeftConsultationId: null,
  setVoluntarilyLeftConsultationId: (id) => set({ voluntarilyLeftConsultationId: id }),
}))
