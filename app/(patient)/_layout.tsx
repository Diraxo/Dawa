import { useAuth } from '@clerk/clerk-expo'
import { Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { useActiveConsultationRecovery } from '@/hooks/useActiveConsultationRecovery'
import { useAuthStore } from '@/store/authStore'

export default function PatientLayout() {
  const { isSignedIn, isLoaded } = useAuth()
  const { userRole, _hasHydrated } = useAuthStore()
  const router = useRouter()

  // Auth guard
  useEffect(() => {
    if (!isLoaded || !_hasHydrated) return
    if (!isSignedIn || userRole !== 'patient') {
      router.replace('/(auth)/sign-in' as never)
    }
  }, [isLoaded, isSignedIn, userRole, _hasHydrated])

  // DB-driven session recovery — runs on mount and whenever the app returns
  // to the foreground. Authoritative (queries consultations directly), so it
  // works even across reinstalls/devices, not just within the same app
  // session that set local storage.
  useActiveConsultationRecovery('patient', isLoaded && isSignedIn && userRole === 'patient' && _hasHydrated)

  return <Stack screenOptions={{ headerShown: false }} />
}
