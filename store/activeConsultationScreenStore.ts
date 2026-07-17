import { create } from 'zustand'

interface ActiveConsultationScreenState {
  // The consultation id of whichever chat/phone/video consultation screen is
  // currently mounted and focused, or null if the user isn't inside any
  // consultation. Read by usePushNotifications.ts's foreground handler to
  // decide whether an incoming consultation push (accepted, patient_joined,
  // patient_left, completed, summary_ready, etc.) should show a banner (user
  // is elsewhere) or be suppressed as redundant (user is already looking at
  // that exact consultation, which already updates live via its own Realtime
  // subscription). Mirrors the activeChatStore pattern used for Stream chat
  // message notifications.
  // Deliberately not persisted — this only ever describes the live session.
  activeConsultationId: string | null
  setActiveConsultationId: (id: string | null) => void
}

export const useActiveConsultationScreenStore = create<ActiveConsultationScreenState>()((set) => ({
  activeConsultationId: null,
  setActiveConsultationId: (id) => set({ activeConsultationId: id }),
}))
