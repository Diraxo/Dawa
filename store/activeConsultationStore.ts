import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface ActiveConsultation {
  consultationId: string
  type: 'phone' | 'video' | 'chat'
  otherPersonName: string
  role: 'patient' | 'doctor'
  elapsedSeconds: number
  status: 'active' | 'reconnecting'
}

interface ActiveConsultationState {
  active: ActiveConsultation | null
  setActive: (c: ActiveConsultation | null) => void
  updateElapsed: (s: number) => void
  setConnectionStatus: (status: 'active' | 'reconnecting') => void
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
