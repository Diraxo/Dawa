import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { streamClient } from '@/lib/stream'
import { logger } from '@/lib/logger'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useConsultationPresenceStore } from '@/store/consultationPresenceStore'
import { useDoctorStore } from '@/store/doctorStore'

type UserRole = 'patient' | 'doctor' | null

interface AuthState {
  userRole: UserRole
  userId: string | null
  userName: string | null
  userPhotoUrl: string | null
  isStreamConnected: boolean
  // True once a connection attempt has failed and given up (bad/expired
  // token, generate-stream-token unreachable, connectUser rejected, or the
  // attempt timed out). Distinct from `isStreamConnected === false`, which is
  // also the state while a connection is still in flight — without this,
  // screens gating a spinner on `!isStreamConnected` can't tell "still
  // connecting" from "gave up," so a failed attempt (no automatic retry,
  // see useStreamConnection) left them spinning forever with no way out.
  streamConnectionError: boolean
  // Bumped by retryStreamConnection() to force useStreamConnection's effect
  // to re-run and attempt another connection after a failure.
  streamConnectRetryTick: number
  _hasHydrated: boolean
  // Set synchronously (before any await) the instant a cold-launch push
  // notification tap is about to route somewhere specific (e.g. the doctor's
  // incoming-request screen). Not persisted — splash.tsx reads it once via
  // getState() to skip its own default role-based redirect, so a queued
  // notification's navigation is never stomped by splash landing on Home.
  pendingNotificationRoute: boolean

  setUserRole: (role: UserRole) => void
  setUser: (userId: string, name: string, photoUrl: string | null) => void
  connectStream: (token: string) => Promise<void>
  disconnectStream: () => Promise<void>
  clearAuth: () => void
  setHasHydrated: (v: boolean) => void
  setPendingNotificationRoute: (v: boolean) => void
  retryStreamConnection: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      userRole: null,
      userId: null,
      userName: null,
      userPhotoUrl: null,
      isStreamConnected: false,
      streamConnectionError: false,
      streamConnectRetryTick: 0,
      _hasHydrated: false,
      pendingNotificationRoute: false,

      setUserRole: (role) => set({ userRole: role }),
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setPendingNotificationRoute: (v) => set({ pendingNotificationRoute: v }),
      retryStreamConnection: () =>
        set((s) => ({ streamConnectionError: false, streamConnectRetryTick: s.streamConnectRetryTick + 1 })),

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
          set({ isStreamConnected: true, streamConnectionError: false })
        } catch (err) {
          logger.error('[Stream] connectUser failed:', err)
          set({ streamConnectionError: true })
        }
      },

      disconnectStream: async () => {
        try {
          await streamClient.disconnectUser()
        } catch {}
        set({ isStreamConnected: false })
      },

      clearAuth: () => {
        // Disconnect Stream before clearing state to prevent orphan connections.
        // Must .catch (not just wrap in try/catch) — this is fire-and-forget,
        // and a sync try/catch around an unawaited promise does not catch its
        // rejection, which otherwise surfaces as an unhandled promise rejection
        // (e.g. AxiosError: Network Error) when the disconnect call is offline.
        streamClient.disconnectUser().catch(() => {})
        set({
          userRole: null,
          userId: null,
          userName: null,
          userPhotoUrl: null,
          isStreamConnected: false,
        })
        // The "active consultation" banner state is persisted to AsyncStorage
        // independently of this store and is device-scoped, not account-scoped.
        // Without clearing it here, signing out (or deleting the account) left
        // a stale "Resume" banner pointing at a dead consultation, visible even
        // on the signed-out sign-in screen and surviving into the next account
        // signed into on the same device.
        useActiveConsultationStore.getState().setActive(null)

        // Not persisted, but not role-scoped either — without clearing here,
        // a stale hasActiveConsultation=true from the account that just
        // signed out could block the next tabs render on a shared device
        // until the new account's own recovery check corrects it.
        useConsultationPresenceStore.getState().setHasActiveConsultation(false)
        useConsultationPresenceStore.getState().setVoluntarilyLeftConsultationId(null)

        // dawa-doctor-storage persists registration-draft fields
        // (regFullName, regLicenseNumber, regBio, etc.) plus isOnline/
        // doctorStatus — none of it was ever cleared on sign-out, so a
        // doctor who signs out mid-registration leaves their draft sitting
        // in AsyncStorage for whichever account (their own re-login, or a
        // different doctor on a shared device) signs in next.
        const doctorState = useDoctorStore.getState()
        doctorState.clearReg()
        doctorState.setIsOnline(false)
        doctorState.setDoctorStatus(null)
      },
    }),
    {
      name: 'dawa-auth-storage',
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
