import '../global.css'
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n'
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from '@expo-google-fonts/montserrat'
import { ClerkLoaded, ClerkProvider, useAuth } from '@clerk/clerk-expo'
import * as Notifications from 'expo-notifications'
import { SplashScreen, Stack, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useStreamConnection } from '@/hooks/useStreamConnection'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { streamClient } from '@/lib/stream'
import { setClerkTokenGetter } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import ForceUpdateScreen from '@/components/shared/ForceUpdateScreen'

// OverlayProvider is required lazily so this layout file doesn't crash in Expo Go
// (stream-chat-expo uses a native TurboModule not registered in Expo Go).
let OverlayProvider: React.ComponentType<{ children: React.ReactNode }> =
  ({ children }) => <>{children}</>
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  OverlayProvider = require('stream-chat-expo').OverlayProvider
} catch {}


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
  const { getToken, isSignedIn } = useAuth()

  // Inject Clerk's getToken into the Supabase client so every DB call
  // automatically sends the right JWT — works on both web and native.
  useEffect(() => {
    if (isSignedIn) {
      setClerkTokenGetter(() => getToken())
    } else {
      setClerkTokenGetter(null)
    }
  }, [isSignedIn, getToken])

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

      if (Platform.OS !== 'web') {
        Notifications.scheduleNotificationAsync({
          content: {
            title: senderName,
            body: preview,
            sound: 'default',
            data: { screen: 'chat', channelId },
          },
          trigger: null,
        })
      }
    })

    return () => sub.unsubscribe()
  }, [isStreamConnected, userId])

  // ── Handle notification tap — navigate to correct screen ─────────────────

  useEffect(() => {
    const navigate = (data: Record<string, string>) => {
      const { screen, consultationId, consultationType, channelId } = data ?? {}

      switch (screen) {
        case 'appointments':
          router.push('/(patient)/(tabs)/appointments')
          break

        case 'chat':
          if (channelId) {
            if (userRole === 'doctor') {
              router.push({ pathname: '/(doctor)/chat-consultation', params: { channelId } })
            } else {
              router.push({ pathname: '/(patient)/chat-consultation', params: { channelId } })
            }
          }
          break

        // Patient: doctor accepted — go directly to the consultation room
        case 'consultation': {
          if (consultationId) {
            const type = consultationType ?? 'chat'
            const pathname =
              type === 'video'
                ? '/(patient)/video-consultation'
                : type === 'phone'
                ? '/(patient)/phone-consultation'
                : '/(patient)/chat-consultation'
            router.push({
              pathname,
              params: {
                consultationId,
                channelId: consultationId,
                doctorName: data.doctorName ?? 'Doctor',
                doctorId: data.doctorId ?? '',
              },
            })
          } else {
            router.push('/(patient)/(tabs)/appointments')
          }
          break
        }

        // Patient: just booked, still waiting for doctor to accept
        case 'waiting-room':
        case 'waiting':
          if (consultationId) {
            router.push({
              pathname: '/(patient)/waiting-room',
              params: {
                consultationId,
                consultationType: consultationType ?? 'chat',
                doctorName: data.doctorName ?? 'Doctor',
                doctorId: data.doctorId ?? '',
              },
            })
          } else {
            router.push('/(patient)/(tabs)/appointments')
          }
          break

        // Doctor: incoming consultation request
        case 'incoming_request':
          if (consultationId) {
            router.push({
              pathname: '/(doctor)/incoming-request',
              params: {
                consultationId,
                consultationType: consultationType ?? 'chat',
                patientName: data.patientName ?? 'Patient',
                patientId: data.patientId ?? '',
                patientClerkId: data.patientClerkId ?? '',
                waitingStartedAt: data.waitingStartedAt ?? '',
              },
            })
          } else {
            router.push('/(doctor)/(tabs)/consultations')
          }
          break

        // Patient: consultation summary is ready
        case 'consultation_summary':
          if (consultationId) {
            router.push({
              pathname: '/(patient)/consultation-summary',
              params: { consultationId },
            })
          }
          break

        // Doctor: go to consultations tab (for declined/expired notifications)
        case 'consultations':
          router.push('/(doctor)/(tabs)/consultations')
          break

        // Profile tab (e.g. doctor received a review)
        case 'profile':
          if (userRole === 'doctor') {
            router.push('/(doctor)/(tabs)/profile')
          } else {
            router.push('/(patient)/(tabs)/profile')
          }
          break

        default:
          break
      }
    }

    if (Platform.OS === 'web') return

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

function VersionGate({ children }: { children: React.ReactNode }) {
  const { status, updateMessage, storeUrl, latestVersion } = useVersionCheck()

  if (status === 'update_required') {
    return (
      <ForceUpdateScreen
        message={updateMessage}
        storeUrl={storeUrl}
        latestVersion={latestVersion}
      />
    )
  }

  // While loading, render nothing extra — the native splash is still visible
  return <>{children}</>
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [fontsLoaded, fontError])

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoaded>
          <VersionGate>
            <OverlayProvider>
              <AppInitializer />
              <Stack screenOptions={{ headerShown: false }} />
            </OverlayProvider>
          </VersionGate>
        </ClerkLoaded>
      </ClerkProvider>
    </GestureHandlerRootView>
  )
}
