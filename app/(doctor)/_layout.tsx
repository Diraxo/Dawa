import { useAuth } from '@clerk/clerk-expo'
import { Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { useActiveConsultationRecovery } from '@/hooks/useActiveConsultationRecovery'
import { useAuthStore } from '@/store/authStore'

export default function DoctorLayout() {
  const { isSignedIn, isLoaded } = useAuth()
  const { userRole, _hasHydrated } = useAuthStore()
  const router = useRouter()

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

  return <Stack screenOptions={{ headerShown: false }} />
}
