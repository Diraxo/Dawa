import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useUser } from '@clerk/clerk-expo'

import { supabase } from '@/lib/supabase'
import { registerCallTokens } from '@/lib/voipPush'
import { logger } from '@/lib/logger'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'

// Show notification alert/sound even when the app is in the foreground.
// Incoming-call pushes (VoIP / FCM data) bypass this handler entirely —
// they are intercepted by voipPush.ts before reaching the notification system.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Suppress foreground display for data-only call payloads that arrive via
    // the regular FCM notification channel (belt-and-suspenders deduplication).
    const data = notification.request.content.data as Record<string, unknown>
    if (data?.callType === 'incoming_call') {
      return { shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false }
    }

    // Every consultation-status push (accepted, patient_joined, patient_left,
    // completed, summary_ready, the "tap to join" reminder, etc.) carries
    // consultationId in its data payload. If the user is already looking at
    // that exact chat/phone/video screen, it already reflects the update
    // live via its own Realtime subscription — showing the banner too would
    // just be a redundant "Tap to join" for a consultation they're already in.
    const consultationId = data?.consultationId as string | undefined
    if (consultationId && consultationId === useActiveConsultationScreenStore.getState().activeConsultationId) {
      return { shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false }
    }

    return { shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }
  },
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
      // Highest-priority channel for incoming patient requests — must show on lock screen
      await Notifications.setNotificationChannelAsync('incoming_requests', {
        name: 'Incoming Patient Requests',
        description: 'Alerts when a patient is waiting for your response',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 300, 500, 300, 500],
        lightColor: '#00BFA5',
        sound: 'default',
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        showBadge: true,
      })
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
      // Default channel targeted by handle-consultation-notification's
      // sendPushNotification() for accepted/declined/cancelled/missed_call/
      // summary_ready/summary_updated/review_received — without creating it
      // here, Android has no matching channel to route those pushes into.
      await Notifications.setNotificationChannelAsync('consultations', {
        name: 'Consultations',
        description: 'Updates about your consultation status and summaries',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#00BFA5',
        sound: 'default',
        enableVibrate: true,
      })
      // Doctor account status changes (approved/rejected/suspended/reinstated)
      // — these matter even when the app is fully closed, so MAX importance.
      await Notifications.setNotificationChannelAsync('account', {
        name: 'Account',
        description: 'Updates about your doctor account status',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#00BFA5',
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
      logger.warn('[PushNotifications] Permission denied by user')
      return
    }

    // One-time cleanup: earlier app versions client-scheduled a local
    // "Tap to join" / 5-minute reminder for every scheduled booking
    // (payment-return.tsx), duplicating the server-side reminder cron.
    // Devices upgrading from those versions may still have one of those
    // stale, unfireable-till-later notifications pending — nothing in the
    // app schedules a future-dated local notification anymore, so this is
    // safe to clear unconditionally.
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => {})

    // Get the Expo push token — Expo routes this through FCM on Android, APNs on iOS
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    const pushToken = tokenResponse.data

    // Persist the Expo push token (used for regular in-app notifications)
    const { error } = await supabase
      .from('users')
      .update({ push_token: pushToken })
      .eq('clerk_id', clerkUserId)

    if (error) {
      logger.warn('[PushNotifications] Failed to save push_token:', error.message)
    }

    // Register the Expo push token with Stream Chat so Stream can send
    // push notifications when a new message arrives and the app is offline.
    try {
      const { streamClient } = await import('@/lib/stream')
      if (streamClient.userID) {
        await streamClient.addDevice(pushToken, 'expo', streamClient.userID)
      }
    } catch (streamErr) {
      logger.warn('[PushNotifications] Stream device registration failed:', streamErr)
    }

    // Register call-specific tokens (VoIP token on iOS, FCM token on Android)
    // These are used by the edge function to send system-level call pushes.
    // The onIncoming callback is handled inside app/_layout.tsx via callkeep.onAnswer/onEnd.
    // voipPush.registerCallTokens only needs to display the OS call screen here;
    // navigation is wired up separately in the layout via callkeep event handlers.
    await registerCallTokens(clerkUserId, () => {
      // Payload is handled by the callkeep.onAnswer handler in _layout.tsx.
      // No action needed here — displayIncomingCall() is called inside voipPush.ts
      // before this callback fires.
    })
  } catch (err) {
    logger.warn('[PushNotifications] Registration failed:', err)
  }
}
