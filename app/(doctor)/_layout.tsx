import { useAuth } from '@clerk/clerk-expo'
import { Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { useAuthStore } from '@/store/authStore'

export default function DoctorLayout() {
  const { isSignedIn, isLoaded } = useAuth()
  const { userRole, _hasHydrated } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded || !_hasHydrated) return
    if (!isSignedIn || userRole !== 'doctor') {
      router.replace('/(auth)/splash' as never)
    }
  }, [isLoaded, isSignedIn, userRole, _hasHydrated])

  return <Stack screenOptions={{ headerShown: false }} />
}
