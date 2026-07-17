// index.js — app entry point
//
// This file runs before any React tree is mounted. It registers the Firebase
// background message handler for Android so that high-priority FCM data messages
// can trigger the ConnectionService incoming-call UI (patient side) or the
// full-screen incoming-request notification (doctor side) even when the app
// is killed.
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
          if (uuid) {
            RNCallKeep.endCall(uuid)
            require('@react-native-async-storage/async-storage').default
              .removeItem(`@callkeep_pending_${uuid}`).catch(() => {})
          }
        } catch (e) {
          console.error('[Callkeep] Background cancel failed:', e)
        }
        return
      }

      // A doctor's new consultation request, delivered as a data message so
      // this headless handler can raise its own full-screen incoming-request
      // notification immediately — even app-killed/Doze-restricted — instead
      // of waiting on a plain notification-type push to reach the tray.
      // Deliberately NOT routed through CallKeep/ConnectionService: this is a
      // request to respond to, not an already-answered call, and Google/Apple
      // reserve the telecom call UI for genuine calls.
      if (callType === 'incoming_request') {
        try {
          const data = remoteMessage.data
          const consultationId = String(data.consultationId ?? '')
          if (!consultationId) return

          // Freshness check — the same 'ghost call' guard as below, applied
          // to requests: skip if the doctor (or another device) already
          // resolved this consultation before this (possibly delayed/
          // redelivered) message arrived.
          try {
            const url = process.env.EXPO_PUBLIC_SUPABASE_URL
            const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
            if (url && key) {
              const res = await fetch(
                `${url}/rest/v1/consultations?id=eq.${consultationId}&select=status`,
                { headers: { apikey: key, Authorization: `Bearer ${key}` } },
              )
              const rows = await res.json()
              const status = Array.isArray(rows) && rows[0] ? rows[0].status : null
              if (status && status !== 'waiting_for_doctor') {
                console.log('[IncomingRequest] Stale background request — status is', status, '— skipping')
                return
              }
            }
          } catch (e) {
            // Freshness check failed (offline, etc) — fall through and show
            // the request rather than risk silently dropping a real one.
          }

          const { default: notifee, AndroidImportance, AndroidVisibility } = require('@notifee/react-native')
          const patientName = String(data.patientName ?? 'A patient')
          const typeTitle = data.consultationType === 'phone'
            ? 'Voice Consultation' : data.consultationType === 'video' ? 'Video Consultation' : 'Chat'

          await notifee.createChannel({
            id: 'incoming_requests',
            name: 'Incoming Patient Requests',
            importance: AndroidImportance.HIGH,
            visibility: AndroidVisibility.PUBLIC,
            sound: 'default',
            vibrationPattern: [0, 500, 300, 500, 300, 500],
          })

          await notifee.displayNotification({
            // Deterministic id — a repeated 'new_request' notification for
            // the same consultation (see migration 067's 3-minute re-notify
            // cron) replaces this notification in place instead of stacking
            // a second tray entry for the same request.
            id: `incoming-request-${consultationId}`,
            title: `${typeTitle} with ${patientName}`,
            body: `${patientName} has paid and is waiting for your response.`,
            data: { screen: 'incoming_request', ...data },
            android: {
              channelId: 'incoming_requests',
              importance: AndroidImportance.HIGH,
              category: 'call',
              fullScreenAction: { id: 'default', launchActivity: 'default' },
              pressAction: { id: 'default', launchActivity: 'default' },
              autoCancel: true,
            },
          })
        } catch (e) {
          console.error('[IncomingRequest] Background display failed:', e)
        }
        return
      }

      // Only handle incoming-call data messages below this point
      if (callType !== 'incoming_call') return

      try {
        const data = remoteMessage.data
        const uuid = String(data.uuid ?? data.consultationId ?? '')
        if (!uuid) return

        // 'doctor' = a patient's on-demand request ringing the doctor's
        // device — the *patient* is the caller. Default/'patient' = the
        // existing doctor-accepted → patient rings, doctor is the caller.
        const direction = data.direction === 'doctor' ? 'doctor' : 'patient'
        // Doctor-direction rings represent an unanswered request (still
        // 'waiting_for_doctor'); patient-direction rings represent a
        // doctor-accepted call (still 'accepted').
        const freshStatus = direction === 'doctor' ? 'waiting_for_doctor' : 'accepted'

        // Freshness check ("ghost call" guard) — this headless handler can
        // run for a redelivered/delayed FCM data message (60s TTL, can be
        // retried by the OS) well after the consultation already moved past
        // the state this ring represents (answered elsewhere, cancelled,
        // declined, ended). Skip showing the call screen entirely if it's no
        // longer valid. Plain fetch — no React Native modules are safe to
        // assume are initialized yet in this headless JS context.
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
            if (status && status !== freshStatus) {
              console.log('[Callkeep] Stale background call push — status is', status, '— skipping')
              return
            }
          }
        } catch (e) {
          // Freshness check failed (offline, etc) — fall through and show
          // the call rather than risk silently dropping a real one.
        }

        const RNCallKeep = require('react-native-callkeep').default
        const hasVideo = data.consultationType === 'video'
        let callerHandle
        if (direction === 'doctor') {
          callerHandle = String(data.patientName ?? 'Patient')
        } else {
          const doctorName      = String(data.doctorName      ?? 'Doctor')
          const doctorSpecialty = String(data.doctorSpecialty ?? '')
          callerHandle = doctorSpecialty ? `${doctorName} · ${doctorSpecialty}` : doctorName
        }

        // Persist the full payload under the same AsyncStorage key/shape
        // lib/callkeep.ts writes from displayIncomingCall() so that if the
        // user taps Accept, the brand-new JS context the OS launches on tap
        // can recover it — this headless context (and its in-memory
        // pendingCalls map inside lib/callkeep.ts) is gone by then. See the
        // 'answerCall' listener + persistPendingCall() comment in
        // lib/callkeep.ts for the full explanation.
        try {
          const AsyncStorage = require('@react-native-async-storage/async-storage').default
          const payload = {
            uuid,
            consultationId:   String(data.consultationId ?? uuid),
            consultationType: hasVideo ? 'video' : 'phone',
            doctorName:       String(data.doctorName      ?? 'Doctor'),
            doctorSpecialty:  data.doctorSpecialty  ? String(data.doctorSpecialty)  : undefined,
            doctorPhotoUrl:   data.doctorPhotoUrl   ? String(data.doctorPhotoUrl)   : undefined,
            doctorId:         String(data.doctorId        ?? ''),
            doctorClerkId:    String(data.doctorClerkId   ?? ''),
            agoraChannel:     String(data.agoraChannel    ?? uuid),
            patientClerkId:   data.patientClerkId   ? String(data.patientClerkId)   : undefined,
            patientId:        data.patientId        ? String(data.patientId)        : undefined,
            patientName:      data.patientName      ? String(data.patientName)      : undefined,
            patientPhotoUrl:  data.patientPhotoUrl  ? String(data.patientPhotoUrl)  : undefined,
            direction,
          }
          await AsyncStorage.setItem(
            `@callkeep_pending_${uuid}`,
            JSON.stringify({ payload, savedAt: Date.now() }),
          )
        } catch (e) {
          // best effort — worst case the cold-start Accept fallback has
          // nothing to recover and just logs a warning
        }

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
