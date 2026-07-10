// index.js — app entry point
//
// This file runs before any React tree is mounted. It registers the Firebase
// background message handler for Android so that high-priority FCM data messages
// can trigger the ConnectionService incoming-call UI even when the app is killed.
//
// On iOS, PushKit VoIP pushes wake the app and are handled by
// @react-native-voip-push-notification (registered in app/_layout.tsx).
//
// MUST be listed as "main" in package.json instead of "expo-router/entry".

import { Platform } from 'react-native'

// ── Android: Firebase background message handler (app killed / background) ────
// This headless task runs in a separate JS context without any React UI.
// It must not import any UI component or navigate — only display the call.
if (Platform.OS === 'android') {
  try {
    const messaging = require('@react-native-firebase/messaging').default

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const callType = remoteMessage?.data?.callType

      // A doctor/patient-side cancel that arrived while the app was
      // backgrounded/killed — dismiss any ConnectionService call screen for
      // this consultation instead of leaving it ringing.
      if (callType === 'cancel_call') {
        try {
          const RNCallKeep = require('react-native-callkeep').default
          const uuid = String(remoteMessage.data.uuid ?? remoteMessage.data.consultationId ?? '')
          if (uuid) RNCallKeep.endCall(uuid)
        } catch (e) {
          console.error('[Callkeep] Background cancel failed:', e)
        }
        return
      }

      // Only handle incoming-call data messages
      if (callType !== 'incoming_call') return

      try {
        const data = remoteMessage.data
        const uuid = String(data.uuid ?? data.consultationId ?? '')
        if (!uuid) return

        // Freshness check ("ghost call" guard) — this headless handler can
        // run for a redelivered/delayed FCM data message (60s TTL, can be
        // retried by the OS) well after the consultation already moved past
        // 'accepted' (answered elsewhere, cancelled, ended). Skip showing
        // the call screen entirely if it's no longer valid. Plain fetch —
        // no React Native modules are safe to assume are initialized yet in
        // this headless JS context.
        try {
          const url = process.env.EXPO_PUBLIC_SUPABASE_URL
          const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
          if (url && key) {
            const res = await fetch(
              `${url}/rest/v1/consultations?id=eq.${uuid}&select=status`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } },
            )
            const rows = await res.json()
            const status = Array.isArray(rows) && rows[0] ? rows[0].status : null
            if (status && status !== 'accepted') {
              console.log('[Callkeep] Stale background call push — status is', status, '— skipping')
              return
            }
          }
        } catch (e) {
          // Freshness check failed (offline, etc) — fall through and show
          // the call rather than risk silently dropping a real one.
        }

        const RNCallKeep = require('react-native-callkeep').default
        const doctorName        = String(data.doctorName       ?? 'Doctor')
        const doctorSpecialty   = String(data.doctorSpecialty  ?? '')
        const hasVideo          = data.consultationType === 'video'
        const callerHandle      = doctorSpecialty
          ? `${doctorName} · ${doctorSpecialty}`
          : doctorName

        // Display the native Android ConnectionService call screen
        RNCallKeep.displayIncomingCall(
          uuid,
          callerHandle,       // handle (shown under the name)
          callerHandle,       // localizedCallerName (primary display name)
          'generic',          // handleType
          hasVideo,           // hasVideo
        )
      } catch (e) {
        console.error('[Callkeep] Background display failed:', e)
      }
    })
  } catch (e) {
    // Package not linked — development build required
    console.warn('[Firebase] Messaging not available:', e?.message)
  }
}

// ── Android: Notifee background event handler ──────────────────────────────
// Required by Notifee whenever any notification is displayed with
// android.pressAction set (see hooks/useOngoingConsultationNotification.ts) —
// without a registered background handler, Notifee logs a warning and press
// events that arrive while the app is backgrounded/killed are dropped.
// pressAction.launchActivity: 'default' already brings the app to the
// foreground on its own; deep-linking to the right consultation screen from
// there is handled by the foreground listener in app/_layout.tsx once the
// app is running, so this stub only needs to exist, not act.
if (Platform.OS === 'android') {
  try {
    const notifee = require('@notifee/react-native').default
    notifee.onBackgroundEvent(async () => {})
  } catch (e) {
    console.warn('[Notifee] Background handler not registered:', e?.message)
  }
}

// ── Load Expo Router (mounts the React tree) ─────────────────────────────────
import 'expo-router/entry'
