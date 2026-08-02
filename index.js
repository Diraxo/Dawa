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

// Doctor-side fallback ring when Android's ConnectionService PhoneAccount
// isn't enabled (see the 'incoming_call' branch below) — same Notifee
// full-screen alert (same id/tag) the 'incoming_request' branch already uses
// for chat requests, so it collapses/dedupes with any 'incoming_request'
// message for the same consultation and is silenced by the same
// stopIncomingRequestRing() call incoming-request.tsx already makes on
// mount.
async function ringDoctorFallback(uuid, hasVideo, patientName) {
  try {
    const { default: notifee, AndroidImportance, AndroidVisibility } = require('@notifee/react-native')
    await notifee.createChannel({
      id: 'incoming_requests_v2',
      name: 'Incoming Patient Requests',
      importance: AndroidImportance.MAX,
      visibility: AndroidVisibility.PRIVATE,
      sound: 'default',
      vibrationPattern: [0, 500, 300, 500, 300, 500],
    })
    const typeTitle = hasVideo ? 'Video Consultation' : 'Voice Consultation'
    await notifee.displayNotification({
      id: `incoming-request-${uuid}`,
      title: `New ${typeTitle} request`,
      body: `${patientName || 'A patient'} is waiting for you`,
      data: { screen: 'incoming_request', consultationId: uuid },
      android: {
        channelId: 'incoming_requests_v2',
        importance: AndroidImportance.MAX,
        category: 'call',
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        pressAction: { id: 'default', launchActivity: 'default' },
        autoCancel: true,
        ongoing: true,
        loopSound: true,
        tag: `incoming-request-${uuid}`,
      },
    })
    console.log('[Callkeep] Notifee fallback ring displayed for', uuid)
  } catch (e) {
    console.error('[Callkeep] Notifee fallback ring failed:', e)
  }
}

// ── Android: Firebase background message handler (app killed / background) ────
// This headless task runs in a separate JS context without any React UI.
// It must not import any UI component or navigate — only display the call.
if (Platform.OS === 'android') {
  try {
    const messaging = require('@react-native-firebase/messaging').default

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const callType = remoteMessage?.data?.callType
      console.log('[FCM] Headless background handler invoked, callType=', callType,
        'consultationId=', remoteMessage?.data?.consultationId ?? remoteMessage?.data?.uuid)

      // A doctor/patient-side cancel that arrived while the app was
      // backgrounded/killed — dismiss any ConnectionService call screen for
      // this consultation instead of leaving it ringing.
      if (callType === 'cancel_call') {
        const uuid = String(remoteMessage.data.uuid ?? remoteMessage.data.consultationId ?? '')
        try {
          const RNCallKeep = require('react-native-callkeep').default
          if (uuid) {
            RNCallKeep.endCall(uuid)
            require('@react-native-async-storage/async-storage').default
              .removeItem(`@callkeep_pending_${uuid}`).catch(() => {})
          }
        } catch (e) {
          console.error('[Callkeep] Background cancel failed:', e)
        }
        // Also cancel the doctor's chat-request tray notification (see the
        // 'incoming_request' branch below) — this signal is sent whenever a
        // ringing request leaves the state it represents regardless of
        // consultation type, but a chat request has no CallKeep screen to
        // end, only this Notifee notification, which is otherwise left
        // looping (loopSound below) with nothing to ever stop it.
        try {
          if (uuid) {
            const { default: notifee } = require('@notifee/react-native')
            await notifee.cancelNotification(`incoming-request-${uuid}`)
          }
        } catch (e) {
          console.error('[IncomingRequest] Background cancel failed:', e)
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
          const typeTitle = data.consultationType === 'phone'
            ? 'Voice Consultation' : data.consultationType === 'video' ? 'Video Consultation' : 'Chat'

          // Importance MUST match the 'incoming_requests_v2' channel created
          // by expo-notifications in hooks/usePushNotifications.ts (MAX) —
          // once a channel id exists on-device its settings are immutable,
          // so whichever code path creates it first "wins" permanently.
          // Whichever runs first on a given device (this background handler
          // can run before the JS app ever mounted, e.g. an incoming push
          // arriving right after a fresh install/before first foreground
          // launch) must create it identically, or the channel could get
          // silently pinned at the weaker level.
          //
          // The '_v2' suffix is deliberate: this channel used to be plain
          // 'incoming_requests' at HIGH importance. Bumping the *importance*
          // value in code does nothing for any device that already created
          // that channel — Android ignores importance changes to an existing
          // channel id — so the id itself was changed to force every device
          // to create a brand-new MAX-importance channel regardless of what
          // it already had. Do the same (bump the suffix again) for any
          // future importance/sound/vibration change to this channel.
          await notifee.createChannel({
            id: 'incoming_requests_v2',
            name: 'Incoming Patient Requests',
            importance: AndroidImportance.MAX,
            // PRIVATE (not PUBLIC): title/body below never contain the
            // patient's name specifically so this is safe either way, but
            // PRIVATE also respects the device's own "hide sensitive
            // content on lock screen" setting instead of overriding it —
            // matches the channel created in hooks/usePushNotifications.ts.
            visibility: AndroidVisibility.PRIVATE,
            sound: 'default',
            vibrationPattern: [0, 500, 300, 500, 300, 500],
          })

          console.log('[IncomingRequest] Notifee channel ready, displaying notification for', consultationId)

          // Title/body deliberately stay generic (no patient name) — this is
          // the text Android renders on the tray/lock screen. The patient's
          // name is still in `data` for the in-app incoming-request screen
          // to show once the doctor actually opens it.
          await notifee.displayNotification({
            // Deterministic id — a repeated 'new_request' notification for
            // the same consultation (see migration 067's 3-minute re-notify
            // cron) replaces this notification in place instead of stacking
            // a second tray entry for the same request.
            id: `incoming-request-${consultationId}`,
            title: `New ${typeTitle} request`,
            body: 'A patient is waiting for your response. Open Dawa to review.',
            data: { screen: 'incoming_request', ...data },
            android: {
              channelId: 'incoming_requests_v2',
              importance: AndroidImportance.MAX,
              category: 'call',
              fullScreenAction: { id: 'default', launchActivity: 'default' },
              pressAction: { id: 'default', launchActivity: 'default' },
              autoCancel: true,
              // `ongoing` (can't be swiped away) + `loopSound` (Android's
              // FLAG_INSISTENT — repeats the channel's sound+vibration for
              // as long as the notification stays visible) together give a
              // chat request the same "keeps ringing until resolved"
              // behavior CallKeep's native ConnectionService screen already
              // gives phone/video requests, without needing a foreground
              // service. Stopped by notifee.cancelNotification, called from
              // the 'cancel_call' branch above, incoming-request.tsx on
              // mount, and useIncomingConsultationAlert.ts when the request
              // drops off the doctor's waiting queue.
              ongoing: true,
              loopSound: true,
              // Best-effort cross-transport dedup: the server's Expo push
              // fallback for this same event (handle-consultation-notification's
              // 'new_request' case) now sets its own Android `tag` to this
              // same string via Expo's push API `tag` field, which maps to
              // FCM's notification.tag and instructs Android to replace an
              // already-displayed notification sharing that tag instead of
              // stacking a new one.
              //
              // This is NOT a guaranteed collapse: Android's NotificationManager
              // identifies a notification by the (tag, id) PAIR, not tag
              // alone. FCM's own auto-display for a tagged notification-type
              // message is publicly documented as replacing an existing
              // notification with the same tag, which is only possible if
              // FCM's SDK pins a fixed internal id for tagged notifications
              // (its API exposes no separate id control, so this is the only
              // way "same tag replaces" can work as documented) — but
              // Notifee's own id-to-(tag,id) mapping for its `id` field is
              // NOT publicly documented, and could hash to a different
              // numeric id than whatever fixed id FCM's SDK uses internally.
              // If the numeric ids don't line up, this still displays
              // correctly (unaffected) but simply won't collapse against the
              // Expo-relayed one — this can only be confirmed by inspecting
              // `adb shell dumpsys notification` on a physical device after
              // both this build and the tagged edge function are live. Worst
              // case if it doesn't collapse: identical to today's behavior
              // (two tray entries), not a regression.
              tag: `incoming-request-${consultationId}`,
            },
          })

          console.log('[IncomingRequest] Notifee displayNotification resolved for', consultationId)

          // Mark this consultation as already-displayed so the separate,
          // unconditionally-sent Expo push fallback (server always sends
          // both — see handle-consultation-notification's 'new_request'
          // case) doesn't stack a second tray notification for the same
          // request when it arrives moments later. Short TTL, read by
          // usePushNotifications.ts's setNotificationHandler; if this write
          // never happens (Doze/OEM dropped this data message entirely),
          // the marker stays absent and the fallback still displays
          // normally — reliability is unaffected either way.
          try {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default
            await AsyncStorage.setItem(`@incoming_request_displayed_${consultationId}`, String(Date.now()))
          } catch (e) {
            // best effort
          }
        } catch (e) {
          console.error('[IncomingRequest] Background display failed:', e)
        }
        return
      }

      // Every "regular" notification (accepted/completed/summary_ready/
      // declined/etc.) — sent by the edge function's Expo-relay fallback,
      // which never actually auto-displays on Android (see the doc comment
      // on sendGeneralNotificationFCMFallback in handle-consultation-
      // notification/index.ts for why: @react-native-firebase/messaging's
      // FirebaseMessagingService wins Android's one-listener-per-app FCM
      // delivery over expo-notifications' own, so Expo's relay never gets a
      // chance to build/show anything). Build and display it ourselves here
      // instead, exactly like the 'incoming_request' branch above already
      // does — this headless handler is the one Android actually invokes.
      if (callType === 'general_notification') {
        try {
          const data = remoteMessage.data
          let extra = {}
          try { extra = data.payload ? JSON.parse(data.payload) : {} } catch (e) {}

          const { default: notifee } = require('@notifee/react-native')
          await notifee.displayNotification({
            id: data.notificationId ? `notif-${data.notificationId}` : undefined,
            title: data.title || 'Dawa',
            body: data.body || '',
            data: extra,
            android: {
              channelId: data.channelId || 'consultations',
              pressAction: { id: 'default', launchActivity: 'default' },
              autoCancel: true,
            },
          })
        } catch (e) {
          console.error('[GeneralNotification] Background display failed:', e)
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

        // Verify Android's ConnectionService PhoneAccount is actually
        // enabled before relying on it — registering it (RNCallKeep.setup(),
        // called from lib/callkeep.ts's init()) does not enable it; the
        // doctor must separately grant it under Settings → Apps → Default
        // apps → Calling accounts, and nothing else ever prompts them to.
        // If it isn't enabled, displayIncomingCall() below produces no UI at
        // all — no ring, no error, nothing the doctor could act on. This
        // headless context is a fresh JS instance each invocation (see the
        // module-reload comment in lib/callkeep.ts), so the app's own
        // cached check there isn't available here — probe fresh instead.
        // Scoped to direction 'doctor' (a patient's on-demand phone/video
        // request ringing the doctor) — the patient-facing ring is
        // unaffected.
        let phoneAccountAvailable = true
        if (direction === 'doctor') {
          try {
            const [serviceAvailable, hasAccount] = await Promise.all([
              RNCallKeep.isConnectionServiceAvailable ? RNCallKeep.isConnectionServiceAvailable() : true,
              RNCallKeep.hasPhoneAccount ? RNCallKeep.hasPhoneAccount() : true,
            ])
            phoneAccountAvailable = !!serviceAvailable && !!hasAccount
          } catch (e) {
            // Check itself failed — don't treat that as proof of
            // unavailability, fall through to the normal native attempt.
            phoneAccountAvailable = true
          }
        }

        if (!phoneAccountAvailable) {
          console.warn('[Callkeep] Android phone account unavailable — ringing via Notifee fallback for', uuid)
          await ringDoctorFallback(uuid, hasVideo, callerHandle)
          return
        }

        // Display the native Android ConnectionService call screen
        console.log('[Callkeep] Calling displayIncomingCall for', uuid, 'direction=', direction)
        try {
          RNCallKeep.displayIncomingCall(
            uuid,
            callerHandle,       // handle (shown under the name)
            callerHandle,       // localizedCallerName (primary display name)
            'generic',          // handleType
            hasVideo,           // hasVideo
          )
          console.log('[Callkeep] displayIncomingCall returned for', uuid)
        } catch (e) {
          console.error('[Callkeep] displayIncomingCall threw:', e)
          // Reactive fallback — the proactive check above passed (or was
          // skipped for a non-doctor ring) but the actual native call still
          // failed. Last line of defense against silence for the doctor.
          if (direction === 'doctor') {
            await ringDoctorFallback(uuid, hasVideo, callerHandle)
          }
        }
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
