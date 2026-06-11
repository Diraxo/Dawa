import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useUser } from '@clerk/clerk-expo'

import { supabase } from '@/lib/supabase'

// Show notification alert/sound even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export function usePushNotifications() {
  const { user } = useUser()

  useEffect(() => {
    if (!user) return
    _register(user.id)
  }, [user?.id])
}

async function _register(clerkUserId: string) {
  try {
    // Android requires explicit notification channels
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('appointments', {
        name: 'Appointments',
        description: 'Notifies you when a consultation is about to start',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#00BFA5',
        sound: 'default',
        enableVibrate: true,
      })
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        description: 'Notifies you when you receive a new chat message',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200],
        lightColor: '#2962FF',
        sound: 'default',
        enableVibrate: true,
      })
    }

    // Request permission (shows system dialog on first launch)
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.warn('[PushNotifications] Permission denied by user')
      return
    }

    // Get the Expo push token — Expo routes this through FCM on Android, APNs on iOS
    // Requires EAS projectId in app.json → extra.eas.projectId
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    const pushToken = tokenResponse.data

    // Persist the token so the backend can send notifications to this device
    const { error } = await supabase
      .from('users')
      .update({ push_token: pushToken })
      .eq('clerk_id', clerkUserId)

    if (error) {
      console.warn('[PushNotifications] Failed to save token to Supabase:', error.message)
    }
  } catch (err) {
    console.warn('[PushNotifications] Registration failed:', err)
  }
}
