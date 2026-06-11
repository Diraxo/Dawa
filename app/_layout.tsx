import '../global.css'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n'
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from '@expo-google-fonts/montserrat'
import { ClerkLoaded, ClerkProvider } from '@clerk/clerk-expo'
import * as Notifications from 'expo-notifications'
import { SplashScreen, Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { OverlayProvider } from 'stream-chat-expo'

import { useStreamConnection } from '@/hooks/useStreamConnection'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'


const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!

const tokenCache = {
  async getToken(key: string) {
    return AsyncStorage.getItem(key)
  },
  async saveToken(key: string, value: string) {
    return AsyncStorage.setItem(key, value)
  },
  async clearToken(key: string) {
    return AsyncStorage.removeItem(key)
  },
}


SplashScreen.preventAutoHideAsync()

// ─── Inner component — must be inside ClerkProvider to use Clerk hooks ─────────

function AppInitializer() {
  const router = useRouter()
  const { userId, userRole, isStreamConnected } = useAuthStore()

  // Connect user to Stream Chat after Clerk sign-in
  useStreamConnection()

  // Restore saved language preference on every cold start
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((code) => {
      if (code && code !== i18n.language) {
        i18n.changeLanguage(code)
      }
    })
  }, [])

  // Register for push notifications and save the token to Supabase
  usePushNotifications()

  // ── In-app notification when a new Stream message arrives ─────────────────
  // Only fires when the app is in the foreground. Messages sent by the current
  // user are silently skipped. Background push is handled by FCM via Stream's
  // webhook (configured on the server).

  useEffect(() => {
    if (!isStreamConnected || !userId) return

    const sub = streamClient.on('message.new', (event) => {
      // Skip if the message was sent by the current user
      if (!event.message || event.message.user?.id === userId) return

      const senderName = event.message.user?.name ?? 'New message'
      const text = event.message.text ?? ''
      const hasAttachment = (event.message.attachments?.length ?? 0) > 0
      const preview = text
        ? (text.length > 80 ? `${text.slice(0, 77)}...` : text)
        : hasAttachment
        ? '📎 Sent an attachment'
        : 'New message'

      const channelId = event.channel_id ?? ''

      Notifications.scheduleNotificationAsync({
        content: {
          title: senderName,
          body: preview,
          sound: 'default',
          data: { screen: 'chat', channelId },
        },
        trigger: null,
      })
    })

    return () => sub.unsubscribe()
  }, [isStreamConnected, userId])

  // ── Handle notification tap — navigate to correct screen ─────────────────

  useEffect(() => {
    const navigate = (data: Record<string, string>) => {
      if (data?.screen === 'appointments') {
        router.push('/(patient)/(tabs)/appointments')
      } else if (data?.screen === 'chat' && data.channelId) {
        // Route to the correct chat screen based on the user's role
        if (userRole === 'doctor') {
          router.push({
            pathname: '/(doctor)/chat-consultation',
            params: { channelId: data.channelId },
          })
        } else {
          router.push({
            pathname: '/(patient)/chat-consultation',
            params: { channelId: data.channelId },
          })
        }
      }
    }

    const tapSub = Notifications.addNotificationResponseReceivedListener(response => {
      navigate(response.notification.request.content.data as Record<string, string>)
    })

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return
      navigate(response.notification.request.content.data as Record<string, string>)
    })

    return () => tapSub.remove()
  }, [userRole])

  return null
}

// ─── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontError])

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoaded>
          <OverlayProvider>
            <AppInitializer />
            <Stack screenOptions={{ headerShown: false }} />
          </OverlayProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </GestureHandlerRootView>
  )
}
