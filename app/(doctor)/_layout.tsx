import { useAuth } from '@clerk/clerk-expo'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { useActiveConsultationRecovery } from '@/hooks/useActiveConsultationRecovery'
import { useDoctorPresenceSession } from '@/hooks/useDoctorPresenceSession'
import { getAuthClient } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// Momentary interruptions (screen lock, a notification banner, an incoming-call
// overlay, switching to the camera for a photo) all fire an AppState transition
// away from 'active' and back within a few seconds — long enough to ignore,
// short enough that flipping is_online offline for it was pure false-flapping.
const BACKGROUND_GRACE_MS = 20_000

export default function DoctorLayout() {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const { userRole, _hasHydrated } = useAuthStore()
  const router = useRouter()
  const appStateRef = useRef(AppState.currentState)

  useEffect(() => {
    if (!isLoaded || !_hasHydrated) return
    if (!isSignedIn || userRole !== 'doctor') {
      router.replace('/(auth)/sign-in' as never)
    }
  }, [isLoaded, isSignedIn, userRole, _hasHydrated])

  // DB-driven session recovery — restores the doctor straight into the
  // incoming request screen or the live consultation after app kill,
  // refresh, or backgrounding, instead of leaving them on the tabs Home.
  useActiveConsultationRecovery('doctor', isLoaded && isSignedIn && userRole === 'doctor' && _hasHydrated)

  // Runs for the whole doctor session (every screen, not just the home tab)
  // so the last_seen_at heartbeat never lapses mid-consultation.
  useDoctorPresenceSession(isLoaded && isSignedIn && userRole === 'doctor' && _hasHydrated)

  // A doctor who backgrounds/kills the app while "online" would otherwise
  // stay online in the DB forever (no heartbeat expiry covers this case
  // instantly), so we still flip is_online false on backgrounding. But doing
  // it the INSTANT the app leaves 'active' made the status flap constantly in
  // practice — locking the screen, a notification banner pull-down, an
  // incoming-call overlay, or switching to the camera for 2 seconds all count
  // as "leaving active" on iOS/Android, so patients saw the doctor go offline
  // dozens of times a day despite the doctor never intending to stop taking
  // patients. Give it a grace window instead: only flip offline if the app is
  // STILL backgrounded after BACKGROUND_GRACE_MS, and cancel the pending flip
  // if the doctor returns before then. RLS scopes the update to the caller's
  // own doctor_profiles row.
  useEffect(() => {
    if (!isSignedIn || userRole !== 'doctor') return
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const goingBackground = appStateRef.current === 'active' && next !== 'active'
      const returningActive = appStateRef.current !== 'active' && next === 'active'
      appStateRef.current = next

      if (returningActive && graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = null
        return
      }
      if (!goingBackground) return

      graceTimer = setTimeout(() => {
        graceTimer = null
        if (appStateRef.current === 'active') return
        getToken().then(async token => {
          if (!token) return
          try {
            const client = getAuthClient(token)
            // Never flip offline mid-consultation — the doctor may have
            // backgrounded the app during a phone/chat call that's still
            // live; the heartbeat keeps last_seen_at fresh in the meantime,
            // and the offline flip (or the TTL sweep) will apply once the
            // consultation actually ends.
            const { data: dp } = await client.from('doctor_profiles').select('id').single()
            if (dp) {
              const { data: busy } = await client.rpc('is_doctor_busy', { p_doctor_id: dp.id })
              if (busy) return
            }
            await client.from('doctor_profiles').update({ is_online: false })
          } catch {
            // best-effort; the heartbeat TTL cleanup is the safety net
          }
        })
      }, BACKGROUND_GRACE_MS)
    })
    return () => {
      sub.remove()
      if (graceTimer) clearTimeout(graceTimer)
    }
  }, [isSignedIn, userRole])

  return <Stack screenOptions={{ headerShown: false }} />
}
