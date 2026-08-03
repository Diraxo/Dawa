import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

/**
 * Safety net for the pre-auth screens (country, language) that have no other
 * awareness of auth state. If Clerk ever reports a signed-in user with an
 * existing role while one of these screens is mounted — e.g. because an
 * earlier race sent them here despite already being authenticated — bounce
 * them straight to their home instead of leaving them stuck re-doing
 * onboarding. A signed-in user with no role yet (mid-signup, still on
 * role.tsx next) is left alone.
 */
export function useAuthenticatedRedirect() {
  const router = useRouter()
  const { isSignedIn, userId } = useAuth()
  const { userRole: localRole, setUserRole } = useAuthStore()
  const firedRef = useRef(false)

  useEffect(() => {
    if (!isSignedIn || !userId || firedRef.current) return
    firedRef.current = true

    ;(async () => {
      try {
        const { data } = await supabase.from('users').select('role').eq('clerk_id', userId).single()
        if (data?.role === 'doctor') {
          setUserRole('doctor')
          router.replace('/(doctor)/(tabs)/home' as never)
        } else if (data?.role === 'patient') {
          setUserRole('patient')
          router.replace('/(patient)/(tabs)/home' as never)
        }
        // No role yet — brand new user still finishing onboarding, stay put.
      } catch {
        if (localRole === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
        else if (localRole === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      } finally {
        firedRef.current = false
      }
    })()
  }, [isSignedIn, userId, localRole, router, setUserRole])
}
