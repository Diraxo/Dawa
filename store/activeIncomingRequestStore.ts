import { create } from 'zustand'

interface ActiveIncomingRequestState {
  // The consultation id of whichever waiting_for_doctor request is currently
  // being shown on the single full-screen incoming-request route
  // (app/(doctor)/incoming-request.tsx). Every surface that can discover a
  // new incoming request — a push-notification tap, the Consultations tab,
  // and the Home tab's own Realtime/poll fallback — must check this before
  // navigating there, so the same request is never presented twice at once
  // (e.g. the full screen from a notification tap plus a second dialog
  // popped up by another surface's own detection of the same row).
  // Deliberately not persisted — this only ever describes the live session.
  shownRequestId: string | null
  setShownRequestId: (id: string | null) => void
}

export const useActiveIncomingRequestStore = create<ActiveIncomingRequestState>()((set) => ({
  shownRequestId: null,
  setShownRequestId: (id) => set({ shownRequestId: id }),
}))
