import { useAuth } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { colors } from '@/constants/colors'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

WebBrowser.maybeCompleteAuthSession()

export default function OAuthNativeCallback() {
  const { isSignedIn, userId, getToken } = useAuth()
  const router = useRouter()
  const { setUserRole } = useAuthStore()

  useEffect(() => {
    if (!isSignedIn || !userId) return
    ;(async () => {
      try {
        const token = await getToken()
        const client = token ? getAuthClient(token) : supabase
        const { data } = await client.from('users').select('role').eq('clerk_id', userId).single()
        if (data?.role === 'doctor') {
          setUserRole('doctor')
          router.replace('/(doctor)/(tabs)/home' as never)
        } else if (data?.role === 'patient') {
          setUserRole('patient')
          router.replace('/(patient)/(tabs)/home' as never)
        } else {
          router.replace('/(auth)/role' as never)
        }
      } catch {
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
