import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface ActiveConsultation {
  consultationId: string
  type: 'phone' | 'video' | 'chat'
  otherPersonName: string
  otherPersonPhotoUrl?: string | null
  role: 'patient' | 'doctor'
  elapsedSeconds: number
  // Epoch ms of consultations.started_at (the DB source of truth), once
  // known — lets consumers (e.g. the Android ongoing-call notification)
  // anchor a clock directly instead of back-computing from a possibly-stale
  // elapsedSeconds snapshot taken before the DB row had even loaded.
  callStartedAtMs?: number | null
  status: 'connecting' | 'active' | 'reconnecting'
}

interface ActiveConsultationState {
  active: ActiveConsultation | null
  setActive: (c: ActiveConsultation | null) => void
  updateElapsed: (s: number) => void
  updateIdentity: (name: string, photoUrl?: string | null) => void
  updateCallStartedAt: (ms: number | null) => void
  setConnectionStatus: (status: 'connecting' | 'active' | 'reconnecting') => void
}

export const useActiveConsultationStore = create<ActiveConsultationState>()(
  persist(
    (set) => ({
      active: null,

      setActive: (c) => set({ active: c }),

      updateElapsed: (s) =>
        set(state =>
          state.active ? { active: { ...state.active, elapsedSeconds: s } } : {}
        ),

      // The initial setActive() snapshot is taken at call-screen mount,
      // before the async live-profile fetch resolves — without this, a
      // doctor/patient name or photo edited mid-call (or simply not yet
      // loaded at mount) stays wrong in the Resume banner and Android
      // notification for the rest of the call.
      updateIdentity: (name, photoUrl) =>
        set(state =>
          state.active
            ? { active: { ...state.active, otherPersonName: name, otherPersonPhotoUrl: photoUrl } }
            : {}
        ),

      updateCallStartedAt: (ms) =>
        set(state =>
          state.active ? { active: { ...state.active, callStartedAtMs: ms } } : {}
        ),

      setConnectionStatus: (status) =>
        set(state =>
          state.active ? { active: { ...state.active, status } } : {}
        ),
    }),
    {
      name: 'carehub-active-consultation',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
