import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, AppStateStatus, Linking, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useUser } from '@clerk/clerk-expo'

import { supabase } from '@/lib/supabase'
import { registerCallTokens } from '@/lib/voipPush'
import { reclaimTokenFromOtherUsers } from '@/lib/pushTokens'
import { logger } from '@/lib/logger'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'

// Show notification alert/sound even when the app is in the foreground.
// Incoming-call pushes (VoIP / FCM data) bypass this handler entirely —
// they are intercepted by voipPush.ts before reaching the notification system.
const SUPPRESS = { shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false } as const
const INCOMING_REQUEST_DEDUP_WINDOW_MS = 15_000

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Suppress foreground display for data-only call payloads that arrive via
    // the regular FCM notification channel (belt-and-suspenders deduplication).
    const data = notification.request.content.data as Record<string, unknown>
    if (data?.callType === 'incoming_call') {
      return SUPPRESS
    }

    // The 'new_request' Expo push fallback (handle-consultation-notification's
    // 'new_request' case) is sent unconditionally alongside the FCM data
    // message that index.js's background handler / voipPush.ts's foreground
    // handler already turn into a Notifee/locally-scheduled notification —
    // without this check, a chat request shows two near-identical tray
    // entries for the same consultation. Only suppress when that marker
    // confirms the real one actually displayed; if it's missing (Doze/OEM
    // dropped the data message before this ran), let this fallback through
    // unchanged so the doctor still gets alerted.
    if (data?.callType === 'incoming_request' && typeof data?.consultationId === 'string') {
      try {
        const shownAt = await AsyncStorage.getItem(`@incoming_request_displayed_${data.consultationId}`)
        if (shownAt && Date.now() - Number(shownAt) < INCOMING_REQUEST_DEDUP_WINDOW_MS) {
          return SUPPRESS
        }
      } catch {
        // best effort — fall through and show the fallback
      }
    }

    // Every consultation-status push (accepted, patient_joined, patient_left,
    // completed, summary_ready, the "tap to join" reminder, etc.) carries
    // consultationId in its data payload. If the user is already looking at
    // that exact chat/phone/video screen, it already reflects the update
    // live via its own Realtime subscription — showing the banner too would
    // just be a redundant "Tap to join" for a consultation they're already in.
    const consultationId = data?.consultationId as string | undefined
    if (consultationId && consultationId === useActiveConsultationScreenStore.getState().activeConsultationId) {
      return SUPPRESS
    }

    return { shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }
  },
})

export interface NotificationPermissionPrompt {
  visible: boolean
  dismiss: () => void
  openSettings: () => void
}

// userRole (patient/doctor) only changes what the dialog's body copy says —
// doctors get an extra line about missing consultations. Passing it is
// optional so callers that don't yet know the role (e.g. before sign-in)
// still get the base copy.
export function usePushNotifications(userRole?: 'patient' | 'doctor' | null): NotificationPermissionPrompt {
  const { user } = useUser()
  const [promptVisible, setPromptVisible] = useState(false)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    if (!user) return
    _register(user.id, () => setPromptVisible(true))
  }, [user?.id])

  // Detect the user coming back from the OS Settings screen (or just
  // resuming the app) and re-check permission status — if it's now granted,
  // dismiss the dialog automatically; if still disabled, leave it to
  // reappear on the next cold app open (handled by the _register effect
  // above running again on mount).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const wasBackgrounded = appStateRef.current.match(/inactive|background/)
      appStateRef.current = next
      if (!user || !wasBackgrounded || next !== 'active') return
      Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') setPromptVisible(false)
      })
    })
    return () => sub.remove()
  }, [user?.id])

  return {
    visible: promptVisible,
    dismiss: () => setPromptVisible(false),
    openSettings: () => {
      setPromptVisible(false)
      Linking.openSettings().catch(() => {})
    },
  }
}

async function _register(clerkUserId: string, onPermissionDenied: () => void) {
  try {
    // Android requires explicit notification channels
    if (Platform.OS === 'android') {
      // Highest-priority channel for incoming patient requests — must show on
      // lock screen. '_v2' suffix: this channel used to be plain
      // 'incoming_requests' at HIGH importance; Android channel settings are
      // immutable once created, so bumping importance to MAX in code alone
      // never took effect on a device that already had the old channel. The
      // id itself was changed (see matching comment in index.js) to force a
      // fresh MAX-importance channel on every device.
      await Notifications.setNotificationChannelAsync('incoming_requests_v2', {
        name: 'Incoming Patient Requests',
        description: 'Alerts when a patient is waiting for your response',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 300, 500, 300, 500],
        lightColor: '#00BFA5',
        sound: 'default',
        enableVibrate: true,
        // PRIVATE (not PUBLIC): the title/body below carry a patient's name —
        // PUBLIC would force that onto a locked device's lock screen
        // regardless of the OS's own "hide sensitive content" setting.
        // PRIVATE respects whatever the user configured for this device.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
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
      onPermissionDenied()
      return
    }

    // Android can defer or entirely drop the background FCM data message
    // that drives the incoming-consultation ring under Doze/App Standby or
    // OEM battery managers (MIUI, Samsung, OnePlus, etc.) unless this app is
    // exempted from battery optimization — the manifest declares
    // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS but nothing ever prompted the
    // user to actually grant it. There's no single-tap RN-core API for the
    // real system consent dialog (that needs a native intent launcher), so
    // this points the user at the app's battery settings instead — one-time
    // per device, best-effort.
    if (Platform.OS === 'android') {
      _promptBatteryOptimizationOnce().catch(() => {})
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

    // Same device/app-install can have belonged to a different account
    // before this session (account switch on a shared device, or a logout
    // that predates clearPushTokens). Strip this exact token off any other
    // user's row first so that account never receives another push meant
    // for whoever is signed in now.
    await reclaimTokenFromOtherUsers('push_token', pushToken, clerkUserId)

    // Persist the Expo push token (used for regular in-app notifications)
    const { error } = await supabase
      .from('users')
      .update({ push_token: pushToken })
      .eq('clerk_id', clerkUserId)

    if (error) {
      logger.warn('[PushNotifications] Failed to save push_token:', error.message)
    }

    // Register the platform-native device token with Stream Chat so Stream
    // can send push notifications when a new message arrives and the app is
    // offline. Stream's addDevice only accepts 'firebase' | 'apn' | 'huawei'
    // | 'xiaomi' as push_provider — passing the literal string 'expo' (as
    // this used to) is rejected outright ("push_provider must be one of
    // [firebase apn huawei xiaomi]"), so this registration always failed
    // silently and Stream chat push notifications never actually worked.
    // The Expo push token (`pushToken` above) isn't valid here either — it's
    // Expo's own routing token, not the raw FCM/APNs device token Stream
    // needs to call Firebase/APNs directly, so a separate native token is
    // fetched for this call.
    //
    // NOTE: Stream must also have Firebase (Android) / APNs (iOS) push
    // credentials configured under Chat → Overview → Push Notifications in
    // the Stream dashboard — addDevice will accept a valid provider here
    // regardless, but Stream can't actually deliver a push without those
    // credentials on file.
    try {
      const { streamClient } = await import('@/lib/stream')
      if (streamClient.userID && Platform.OS !== 'web') {
        const nativeToken = (await Notifications.getDevicePushTokenAsync()).data
        const provider = Platform.OS === 'ios' ? 'apn' : 'firebase'
        await streamClient.addDevice(nativeToken as string, provider, streamClient.userID)
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

const BATTERY_PROMPT_KEY = '@battery_optimization_prompted_v1'

async function _promptBatteryOptimizationOnce() {
  const already = await AsyncStorage.getItem(BATTERY_PROMPT_KEY)
  if (already) return
  await AsyncStorage.setItem(BATTERY_PROMPT_KEY, '1')

  Alert.alert(
    'Allow background alerts',
    'To make sure you never miss an incoming consultation, open Battery settings for this app and choose "Unrestricted" or "Don\'t optimize".',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
    ],
  )
}
