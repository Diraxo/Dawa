// lib/voipPush.ts
// Registers and syncs device tokens needed for system-level incoming-call pushes.
//
// iOS  → PushKit VoIP token via react-native-voip-push-notification
//          • Delivered as APNs VoIP push (apns-push-type: voip)
//          • Wakes the app even when killed → calls callkeep.displayIncomingCall()
//
// Android → FCM device token via @react-native-firebase/messaging
//          • Delivered as high-priority FCM data message
//          • Wakes the app / headless task → calls RNCallKeep.displayIncomingCall()
//
// Tokens are persisted in users.voip_token / users.fcm_token so the
// handle-consultation-notification edge function can target the correct device.

import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { callkeep, type IncomingCallPayload } from './callkeep'
import { reclaimTokenFromOtherUsers, upsertDevice } from './pushTokens'
import { getOrCreateDeviceId } from './deviceId'
import { logger } from './logger'

// ── Lazy-load native modules ──────────────────────────────────────────────────

let RNVoipPush: any = null
try {
  if (Platform.OS === 'ios') {
    RNVoipPush = require('react-native-voip-push-notification').default
  }
} catch {
  logger.warn('[VoIP] react-native-voip-push-notification not available')
}

let FBMessaging: any = null
try {
  if (Platform.OS === 'android') {
    FBMessaging = require('@react-native-firebase/messaging').default
  }
} catch {
  logger.warn('[FCM] @react-native-firebase/messaging not available')
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * registerCallTokens — call once after the user is signed in and push
 * permission has been granted.  Safe to call multiple times.
 *
 * @param clerkUserId  The Clerk user ID used as the lookup key in `users`
 * @param onIncoming   Called when a VoIP push arrives (iOS foreground / background).
 *                     Display the OS call UI here.
 */
export async function registerCallTokens(
  clerkUserId: string,
  onIncoming: (payload: IncomingCallPayload) => void,
): Promise<void> {
  if (Platform.OS === 'web') return

  try {
    if (Platform.OS === 'ios') {
      await _registerVoIPToken(clerkUserId, onIncoming)
    } else if (Platform.OS === 'android') {
      await _registerFCMToken(clerkUserId, onIncoming)
    }
  } catch (err) {
    logger.warn('[CallTokens] Registration error:', err)
  }
}

// ── iOS: PushKit VoIP token ───────────────────────────────────────────────────

// registerCallTokens is safe to call multiple times (e.g. usePushNotifications'
// effect re-fires whenever the signed-in Clerk user changes), but the native
// listeners below are OS-level singletons — adding them again each call would
// stack N duplicate handlers, each independently calling
// callkeep.displayIncomingCall() for the same push. Guard so listeners are
// wired exactly once per app session; a mutable "current user" ref lets the
// single listener always persist the token to whichever user is signed in
// now, and the token-fetch/persist step below still runs every call.
let voipListenersRegistered = false
let fcmListenersRegistered  = false
let currentVoipClerkUserId: string | null = null
let currentFcmClerkUserId:  string | null = null
let currentOnIncoming: ((payload: IncomingCallPayload) => void) | null = null

async function _registerVoIPToken(
  clerkUserId: string,
  onIncoming: (payload: IncomingCallPayload) => void,
) {
  if (!RNVoipPush) return

  currentVoipClerkUserId = clerkUserId
  currentOnIncoming = onIncoming

  if (voipListenersRegistered) {
    RNVoipPush.registerVoipToken()
    return
  }
  voipListenersRegistered = true

  // ① Token registration — fires once with the device's VoIP token.
  //   Token can change, so re-sync whenever this fires.
  RNVoipPush.addEventListener('register', async (token: string) => {
    logger.log('[VoIP] iOS VoIP token received (len:', token.length, ')')
    if (!currentVoipClerkUserId) return
    try {
      await reclaimTokenFromOtherUsers('voip_token', token, currentVoipClerkUserId)
      const { error } = await supabase
        .from('users')
        .update({ voip_token: token })
        .eq('clerk_id', currentVoipClerkUserId)
      if (error) logger.warn('[VoIP] Failed to save voip_token:', error.message)
      else        logger.log('[VoIP] voip_token saved')

      const deviceId = await getOrCreateDeviceId()
      await upsertDevice({ deviceId, platform: 'ios', voipToken: token })
    } catch (e) {
      logger.warn('[VoIP] supabase update failed:', e)
    }
  })

  // ② Incoming VoIP push — fires even when the app is killed (PushKit wakes it).
  //   MUST call displayIncomingCall SYNCHRONOUSLY (CallKit requirement).
  RNVoipPush.addEventListener('notification', (notification: any) => {
    const data = notification?.getData?.() ?? notification ?? {}
    if (data?.callType === 'cancel_call') return _handleCallCancelData(data)
    logger.log('[VoIP] Incoming VoIP push received')
    if (currentOnIncoming) handleIncomingCallData(data, currentOnIncoming)
  })

  // ③ Trigger registration (fires 'register' event above with the current token)
  RNVoipPush.registerVoipToken()
}

// ── Android: FCM token + foreground message handler ───────────────────────────

async function _registerFCMToken(
  clerkUserId: string,
  onIncoming: (payload: IncomingCallPayload) => void,
) {
  if (!FBMessaging) return

  currentFcmClerkUserId = clerkUserId
  currentOnIncoming = onIncoming

  const messaging = FBMessaging()

  // ① Get the current FCM device token and persist it
  try {
    const token = await messaging.getToken()
    logger.log('[FCM] Android FCM token received (len:', token.length, ')')
    await reclaimTokenFromOtherUsers('fcm_token', token, clerkUserId)
    const { error } = await supabase
      .from('users')
      .update({ fcm_token: token })
      .eq('clerk_id', clerkUserId)
    if (error) logger.warn('[FCM] Failed to save fcm_token:', error.message)
    else        logger.log('[FCM] fcm_token saved')

    const deviceId = await getOrCreateDeviceId()
    await upsertDevice({ deviceId, platform: 'android', fcmToken: token })
  } catch (e) {
    logger.warn('[FCM] getToken failed:', e)
  }

  if (fcmListenersRegistered) return
  fcmListenersRegistered = true

  // ② Token refresh — keep Supabase in sync
  messaging.onTokenRefresh(async (newToken: string) => {
    logger.log('[FCM] Token refreshed')
    if (!currentFcmClerkUserId) return
    try {
      await reclaimTokenFromOtherUsers('fcm_token', newToken, currentFcmClerkUserId)
      await supabase
        .from('users')
        .update({ fcm_token: newToken })
        .eq('clerk_id', currentFcmClerkUserId)

      const deviceId = await getOrCreateDeviceId()
      await upsertDevice({ deviceId, platform: 'android', fcmToken: newToken })
    } catch {}
  })

  // ③ Foreground FCM data message — app is in foreground
  messaging.onMessage(async (remoteMessage: any) => {
    const callType = remoteMessage?.data?.callType
    logger.log('[FCM] onMessage (foreground) received, callType=', callType,
      'consultationId=', remoteMessage?.data?.consultationId ?? remoteMessage?.data?.uuid)
    if (callType === 'cancel_call') return _handleCallCancelData(remoteMessage.data)
    if (callType === 'incoming_request') return _handleIncomingRequestData(remoteMessage.data)
    if (callType === 'general_notification') return _handleGeneralNotificationData(remoteMessage.data)
    if (callType !== 'incoming_call') return
    logger.log('[FCM] Foreground incoming-call message')
    if (currentOnIncoming) handleIncomingCallData(remoteMessage.data, currentOnIncoming)
  })

  // ④ App-opened-from-background FCM data message
  messaging.onNotificationOpenedApp((remoteMessage: any) => {
    const callType = remoteMessage?.data?.callType
    logger.log('[FCM] onNotificationOpenedApp received, callType=', callType,
      'consultationId=', remoteMessage?.data?.consultationId ?? remoteMessage?.data?.uuid)
    if (callType === 'cancel_call') return _handleCallCancelData(remoteMessage.data)
    if (callType !== 'incoming_call') return
    logger.log('[FCM] Background→foreground incoming-call message')
    if (currentOnIncoming) handleIncomingCallData(remoteMessage.data, currentOnIncoming)
  })
}

// A ringing call was cancelled/missed server-side before being answered —
// dismiss any OS call UI still showing for it (belt-and-suspenders on top of
// the freshness check in handleIncomingCallData; catches the case where no
// further incoming-call push arrives to trigger that check).
function _handleCallCancelData(data: Record<string, string>) {
  const uuid = data.uuid || data.consultationId || ''
  if (!uuid) return
  logger.log('[VoIPPush] cancel_call received for', uuid)
  callkeep.reportCallEnded(uuid, 'answeredElsewhere')
  // Also cancel a chat request's tray notification — this signal fires
  // whenever a ringing request leaves the state it represents regardless of
  // consultation type (see the server's sendCallCancelSignal), but a chat
  // request has no CallKeep screen to end, only the loopSound-ing Notifee
  // notification below, which nothing else here would ever stop.
  if (Platform.OS === 'android') {
    try {
      const notifee = require('@notifee/react-native').default
      notifee.cancelNotification(`incoming-request-${uuid}`).catch(() => {})
    } catch {
      // development build required
    }
  }
}

// A new/ready consultation request, delivered as a silent FCM data message
// so index.js's background handler can raise Notifee's full-screen alert
// even app-killed. While foregrounded, that headless handler never runs
// (Firebase only invokes it for background/killed), and this data message
// previously had no `else`/`default` branch here — it was dropped entirely,
// so the doctor's fastest possible signal (server push, arriving well ahead
// of useIncomingConsultationAlert's 10s poll / realtime reconnect) was
// silently discarded. Fires the same continuously-ringing notification as a
// heads-up; that hook's own Realtime/poll detection still independently
// finds the row and shows the full-screen incoming-request UI — this only
// closes the gap between "push arrives" and "app's own polling/realtime
// notices".
function _handleIncomingRequestData(data: Record<string, string>) {
  logger.log('[FCM] Foreground incoming-request message')
  const patientName = data.patientName || 'A patient'
  const typeTitle = data.consultationType === 'phone'
    ? 'Voice Consultation' : data.consultationType === 'video' ? 'Video Consultation' : 'Chat'
  const consultationId = data.consultationId

  // Android: same Notifee call (id/tag, ongoing + loopSound) index.js's
  // background handler uses, so this foreground path rings exactly as
  // continuously — plain expo-notifications can't loop a notification's
  // sound/vibration (no FLAG_INSISTENT equivalent in its API).
  if (Platform.OS === 'android' && consultationId) {
    try {
      const { default: notifee, AndroidImportance } = require('@notifee/react-native')
      notifee.displayNotification({
        id: `incoming-request-${consultationId}`,
        title: `${typeTitle} with ${patientName}`,
        body: `${patientName} has paid and is waiting for your response.`,
        data: { screen: 'incoming_request', ...data },
        android: {
          channelId: 'incoming_requests_v2',
          importance: AndroidImportance.MAX,
          category: 'call',
          fullScreenAction: { id: 'default', launchActivity: 'default' },
          pressAction: { id: 'default', launchActivity: 'default' },
          autoCancel: true,
          ongoing: true,
          loopSound: true,
          tag: `incoming-request-${consultationId}`,
        },
      }).catch(() => {})
    } catch {
      // development build required — no fallback needed here; index.js's
      // background handler and useIncomingConsultationAlert.ts's own
      // Realtime/poll-driven ring still cover this consultation.
    }
  } else {
    Notifications.scheduleNotificationAsync({
      content: {
        title: `${typeTitle} with ${patientName}`,
        body: `${patientName} has paid and is waiting for your response.`,
        sound: 'default',
        data: { screen: 'incoming_request', ...data },
      },
      trigger: null,
    }).catch(() => {})
  }

  // See the matching marker write in index.js's background handler — same
  // dedup contract, foreground side. The server's Expo push fallback for
  // this event carries the same consultationId and now the same callType,
  // so usePushNotifications.ts's setNotificationHandler can recognize this
  // one already displayed and skip stacking a second banner for it.
  if (consultationId) {
    import('@react-native-async-storage/async-storage')
      .then(({ default: AsyncStorage }) =>
        AsyncStorage.setItem(`@incoming_request_displayed_${consultationId}`, String(Date.now())))
      .catch(() => {})
  }
}

// Every "regular" notification (accepted/completed/summary_ready/declined/
// etc.) delivered as a direct FCM data message — see the doc comment on
// sendGeneralNotificationFCMFallback in handle-consultation-notification/
// index.ts for why this exists: on Android, expo-notifications' own
// FirebaseMessagingService loses the one-listener-per-app FCM delivery race
// to @react-native-firebase/messaging's, so Expo's push relay (used by
// every "regular" notification) never gets a chance to auto-display
// anything — this local notification, scheduled through the same
// expo-notifications channel the OS would have used, is what actually
// produces the tray entry + sound while the app is foregrounded. Mirrors
// index.js's headless handler, which does the Android-equivalent (Notifee)
// for the background/killed case.
function _handleGeneralNotificationData(data: Record<string, string>) {
  logger.log('[FCM] Foreground general-notification message, channel=', data.channelId)
  let extra: Record<string, unknown> = {}
  try {
    extra = data.payload ? JSON.parse(data.payload) : {}
  } catch {
    // best effort
  }
  Notifications.scheduleNotificationAsync({
    // Deterministic identifier (matches index.js's Notifee `id` for the same
    // event) — without this, scheduleNotificationAsync defaults to a random
    // UUID per call, so FCM redelivering the same data message (its own
    // retry-on-no-ack behavior, or the 3-minute repeat cron for
    // still-waiting requests) would stack a second tray entry instead of
    // replacing the first. Falls back to a random id only when the server
    // didn't have a notification row to key off of (insertNotification
    // failure) — a rare edge case where losing dedup is an acceptable
    // degradation, not a regression from before this handler existed.
    identifier: data.notificationId ? `notif-${data.notificationId}` : undefined,
    content: {
      title: data.title || 'Dawa',
      body: data.body || '',
      sound: 'default',
      data: extra,
      ...(Platform.OS === 'android' ? { channelId: data.channelId || 'consultations' } : {}),
    },
    trigger: null,
  }).catch(() => {})
}

// ── Shared incoming-call data handler ────────────────────────────────────────
//
// Exported so app/_layout.tsx's iOS cold-start/app-killed PushKit listener
// (registered separately, before Clerk auth resolves and before this file's
// own listener — see registerCallTokens — can be wired) can reuse the same
// staleness guard instead of calling callkeep.displayIncomingCall() directly
// with no freshness check, which previously let an already-answered/
// cancelled/missed VoIP push raise a ghost CallKit screen on that path alone.

export function handleIncomingCallData(
  data: Record<string, string>,
  onIncoming: (payload: IncomingCallPayload) => void,
) {
  const uuid             = data.uuid             || data.consultationId || ''
  const consultationId   = data.consultationId   || ''
  const doctorName       = data.doctorName       || 'Doctor'
  const doctorSpecialty  = data.doctorSpecialty  || ''
  const doctorPhotoUrl   = data.doctorPhotoUrl   || undefined
  const doctorId         = data.doctorId         || ''
  const doctorClerkId    = data.doctorClerkId    || ''
  const consultationType = (data.consultationType === 'video' ? 'video' : 'phone') as 'phone' | 'video'
  const agoraChannel     = data.agoraChannel     || consultationId
  const patientClerkId   = data.patientClerkId   || undefined
  // 'doctor' = a patient's on-demand request ringing the doctor's device
  // (see supabase/functions/handle-consultation-notification's 'new_request'
  // case); default/'patient' = the existing doctor-accepted → patient rings.
  const direction         = data.direction === 'doctor' ? 'doctor' as const : 'patient' as const
  const patientId         = data.patientId        || undefined
  const patientName       = data.patientName      || undefined
  const patientPhotoUrl   = data.patientPhotoUrl  || undefined

  if (!uuid || !consultationId) {
    logger.warn('[VoIPPush] Missing uuid or consultationId in call data')
    return
  }

  logger.log('[VoIPPush] handleIncomingCallData stage — consultationId=', consultationId, 'direction=', direction)

  const payload: IncomingCallPayload = {
    uuid,
    consultationId,
    doctorName,
    doctorSpecialty: doctorSpecialty || undefined,
    doctorPhotoUrl,
    doctorId,
    doctorClerkId,
    consultationType,
    agoraChannel,
    patientClerkId,
    direction,
    patientId,
    patientName,
    patientPhotoUrl,
  }

  // Display the OS call UI first (synchronous requirement on iOS CallKit)
  callkeep.displayIncomingCall(payload)

  // Notify the app layer (sets up navigation, store, etc.)
  onIncoming(payload)

  // Freshness check ("ghost call" guard): Android FCM data messages can be
  // redelivered by the OS up to their TTL, and any push transport can be
  // delayed. If this push arrives after the consultation already moved past
  // the state this ring represents, the OS call UI we just displayed above
  // is stale — dismiss it immediately instead of leaving a phantom ringing
  // call. Doctor-direction rings represent an unanswered request (still
  // 'waiting_for_doctor'); patient-direction rings represent a doctor-
  // accepted call (still 'accepted') — same guard, different expected status.
  const freshStatus = direction === 'doctor' ? 'waiting_for_doctor' : 'accepted'
  ;(async () => {
    try {
      const { data: row } = await supabase
        .from('consultations')
        .select('status')
        .eq('id', consultationId)
        .maybeSingle()
      if (row && row.status !== freshStatus) {
        logger.log('[VoIPPush] Stale incoming-call push for', consultationId, '— status is', row.status, '— dismissing')
        callkeep.reportCallEnded(uuid, 'answeredElsewhere')
      }
    } catch {
      // best effort
    }
  })()
}
