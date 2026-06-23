import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { streamClient } from '@/lib/stream'
import { logger } from '@/lib/logger'

type UserRole = 'patient' | 'doctor' | null

interface AuthState {
  userRole: UserRole
  userId: string | null
  userName: string | null
  userPhotoUrl: string | null
  isStreamConnected: boolean
  _hasHydrated: boolean

  setUserRole: (role: UserRole) => void
  setUser: (userId: string, name: string, photoUrl: string | null) => void
  connectStream: (token: string) => Promise<void>
  disconnectStream: () => Promise<void>
  clearAuth: () => void
  setHasHydrated: (v: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      userRole: null,
      userId: null,
      userName: null,
      userPhotoUrl: null,
      isStreamConnected: false,
      _hasHydrated: false,

      setUserRole: (role) => set({ userRole: role }),
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setUser: (userId, name, photoUrl) =>
        set({ userId, userName: name, userPhotoUrl: photoUrl }),

      connectStream: async (token: string) => {
        const { userId, userName, userPhotoUrl } = get()
        if (!userId) return
        try {
          if (streamClient.userID) await streamClient.disconnectUser()
          await streamClient.connectUser(
            {
              id: userId,
              name: userName ?? undefined,
              image: userPhotoUrl ?? undefined,
            },
            token
          )
          set({ isStreamConnected: true })
        } catch (err) {
          logger.error('[Stream] connectUser failed:', err)
        }
      },

      disconnectStream: async () => {
        try {
          await streamClient.disconnectUser()
        } catch {}
        set({ isStreamConnected: false })
      },

      clearAuth: () => {
        // Disconnect Stream before clearing state to prevent orphan connections
        try { streamClient.disconnectUser() } catch {}
        set({
          userRole: null,
          userId: null,
          userName: null,
          userPhotoUrl: null,
          isStreamConnected: false,
        })
      },
    }),
    {
      name: 'carehub-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        userRole: state.userRole,
        userId: state.userId,
        userName: state.userName,
        userPhotoUrl: state.userPhotoUrl,
        // isStreamConnected not persisted — reconnect on each cold start
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
