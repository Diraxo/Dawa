import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type UserRole = 'patient' | 'doctor' | null

interface AuthState {
  userRole: UserRole
  setUserRole: (role: UserRole) => void
  clearRole: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userRole: null,
      setUserRole: (role) => set({ userRole: role }),
      clearRole: () => set({ userRole: null }),
    }),
    {
      name: 'carehub-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
