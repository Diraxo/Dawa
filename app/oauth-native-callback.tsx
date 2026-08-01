import { useAuth } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { colors } from '@/constants/colors'
import { resolveAuthDestination } from '@/lib/resolveAuthDestination'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

WebBrowser.maybeCompleteAuthSession()

export default function OAuthNativeCallback() {
  const { isSignedIn, userId, getToken } = useAuth()
  const router = useRouter()
  const { setUserRole } = useAuthStore()

  // Confirms the deep link was actually received and what state Clerk
  // resolved it to — if this never logs, the redirect never made it back
  // into the app (Clerk dashboard redirect allowlist / scheme mismatch);
  // if it logs with isSignedIn=false, the deep link arrived but Clerk
  // didn't complete the session from it.
  useEffect(() => {
    console.log('[OAuth callback] mounted, isSignedIn:', isSignedIn, 'userId:', userId ?? null)
  }, [isSignedIn, userId])

  useEffect(() => {
    if (!isSignedIn || !userId) return
    ;(async () => {
      try {
        const token = await getToken()
        const client = token ? getAuthClient(token) : supabase
        const dest = await resolveAuthDestination(client, userId)
        console.log('[OAuth callback] destination resolved:', dest.route)
        if (dest.role) setUserRole(dest.role)
        router.replace(dest.route as never)
      } catch (err) {
        console.error('[OAuth callback] role lookup failed:', err)
        router.replace('/(auth)/role' as never)
      }
    })()
  }, [isSignedIn, userId])

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.tealGreen} />
    </View>
  )
}
