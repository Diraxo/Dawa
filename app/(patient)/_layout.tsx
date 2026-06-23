import { useAuth } from '@clerk/clerk-expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { getAuthClient } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

const PENDING_KEY = 'carehub_pending_consultation'

const ROUTE_MAP: Record<string, string> = {
  chat:  '/(patient)/chat-consultation',
  phone: '/(patient)/phone-consultation',
  video: '/(patient)/video-consultation',
}

// Active statuses that mean the patient has an ongoing session
const WAITING_STATUSES   = new Set(['waiting_for_doctor', 'pending'])
const IN_SESSION_STATUSES = new Set(['accepted', 'in_progress', 'active'])

export default function PatientLayout() {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const { userRole, _hasHydrated } = useAuthStore()
  const router = useRouter()

  // Auth guard
  useEffect(() => {
    if (!isLoaded || !_hasHydrated) return
    if (!isSignedIn || userRole !== 'patient') {
      router.replace('/(auth)/splash' as never)
    }
  }, [isLoaded, isSignedIn, userRole, _hasHydrated])

  // Session recovery — runs on mount and whenever app comes to foreground
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    const checkPending = async () => {
      const stored = await AsyncStorage.getItem(PENDING_KEY)
      if (!stored) return

      let pending: {
        consultationId:   string
        doctorId:         string
        doctorName:       string
        consultationType: string
      }
      try {
        pending = JSON.parse(stored)
      } catch {
        AsyncStorage.removeItem(PENDING_KEY)
        return
      }
      if (!pending.consultationId) {
        AsyncStorage.removeItem(PENDING_KEY)
        return
      }

      const token = await getToken()
      if (!token) return

      const { data, error } = await getAuthClient(token)
        .from('consultations')
        .select('id, status, type')
        .eq('id', pending.consultationId)
        .single()

      if (error || !data) {
        AsyncStorage.removeItem(PENDING_KEY)
        return
      }

      if (WAITING_STATUSES.has(data.status)) {
        // Patient was in waiting room — return them there silently
        router.push({
          pathname: '/(patient)/waiting-room' as any,
          params: {
            consultationId:   pending.consultationId,
            doctorId:         pending.doctorId,
            doctorName:       pending.doctorName,
            consultationType: pending.consultationType ?? data.type ?? 'chat',
          },
        })
      } else if (IN_SESSION_STATUSES.has(data.status)) {
        // Doctor already accepted while app was closed — go straight to consultation
        AsyncStorage.removeItem(PENDING_KEY)
        const route = ROUTE_MAP[data.type ?? 'chat']
        router.push({
          pathname: route as any,
          params: {
            consultationId:   pending.consultationId,
            doctorId:         pending.doctorId,
            doctorName:       pending.doctorName,
          },
        })
      } else {
        // cancelled, declined, completed — clear
        AsyncStorage.removeItem(PENDING_KEY)
      }
    }

    // Small delay so the layout finishes mounting before navigating
    const mountTimer = setTimeout(checkPending, 1200)

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') checkPending()
    })

    return () => {
      clearTimeout(mountTimer)
      sub.remove()
    }
  }, [isLoaded, isSignedIn])

  return <Stack screenOptions={{ headerShown: false }} />
}
