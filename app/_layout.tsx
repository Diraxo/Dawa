import '../global.css'
import '@/lib/i18n'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from '@expo-google-fonts/montserrat'
import { ClerkLoaded, ClerkProvider } from '@clerk/clerk-expo'
import { SplashScreen, Stack } from 'expo-router'
import { useEffect } from 'react'

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
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <Stack screenOptions={{ headerShown: false }} />
      </ClerkLoaded>
    </ClerkProvider>
  )
}
