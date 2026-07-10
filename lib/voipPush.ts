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
import { supabase } from './supabase'
import { callkeep, type IncomingCallPayload } from './callkeep'
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
      const { error } = await supabase
        .from('users')
        .update({ voip_token: token })
        .eq('clerk_id', currentVoipClerkUserId)
      if (error) logger.warn('[VoIP] Failed to save voip_token:', error.message)
      else        logger.log('[VoIP] voip_token saved')
    } catch (e) {
      logger.warn('[VoIP] supabase update failed:', e)
    }
  })

  // ② Incoming VoIP push — fires even when the app is killed (PushKit wakes it).
  //   MUST call displayIncomingCall SYNCHRONOUSLY (CallKit requirement).
  RNVoipPush.addEventListener('notification', (notification: any) => {
    logger.log('[VoIP] Incoming VoIP push received')
    const data = notification?.getData?.() ?? notification ?? {}
    if (currentOnIncoming) _handleIncomingCallData(data, currentOnIncoming)
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
    const { error } = await supabase
      .from('users')
      .update({ fcm_token: token })
      .eq('clerk_id', clerkUserId)
    if (error) logger.warn('[FCM] Failed to save fcm_token:', error.message)
    else        logger.log('[FCM] fcm_token saved')
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
      await supabase
        .from('users')
        .update({ fcm_token: newToken })
        .eq('clerk_id', currentFcmClerkUserId)
    } catch {}
  })

  // ③ Foreground FCM data message — app is in foreground
  messaging.onMessage(async (remoteMessage: any) => {
    const callType = remoteMessage?.data?.callType
    if (callType === 'cancel_call') return _handleCallCancelData(remoteMessage.data)
    if (callType !== 'incoming_call') return
    logger.log('[FCM] Foreground incoming-call message')
    if (currentOnIncoming) _handleIncomingCallData(remoteMessage.data, currentOnIncoming)
  })

  // ④ App-opened-from-background FCM data message
  messaging.onNotificationOpenedApp((remoteMessage: any) => {
    const callType = remoteMessage?.data?.callType
    if (callType === 'cancel_call') return _handleCallCancelData(remoteMessage.data)
    if (callType !== 'incoming_call') return
    logger.log('[FCM] Background→foreground incoming-call message')
    if (currentOnIncoming) _handleIncomingCallData(remoteMessage.data, currentOnIncoming)
  })
}

// A ringing call was cancelled/missed server-side before being answered —
// dismiss any OS call UI still showing for it (belt-and-suspenders on top of
// the freshness check in _handleIncomingCallData; catches the case where no
// further incoming-call push arrives to trigger that check).
function _handleCallCancelData(data: Record<string, string>) {
  const uuid = data.uuid || data.consultationId || ''
  if (!uuid) return
  logger.log('[VoIPPush] cancel_call received for', uuid)
  callkeep.reportCallEnded(uuid, 'answeredElsewhere')
}

// ── Shared incoming-call data handler ────────────────────────────────────────

function _handleIncomingCallData(
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

  if (!uuid || !consultationId) {
    logger.warn('[VoIPPush] Missing uuid or consultationId in call data')
    return
  }

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
  }

  // Display the OS call UI first (synchronous requirement on iOS CallKit)
  callkeep.displayIncomingCall(payload)

  // Notify the app layer (sets up navigation, store, etc.)
  onIncoming(payload)

  // Freshness check ("ghost call" guard): Android FCM data messages can be
  // redelivered by the OS up to their TTL, and any push transport can be
  // delayed. If this push arrives after the consultation already moved past
  // 'accepted' (declined/cancelled/completed/answered on another device/etc),
  // the OS call UI we just displayed above is stale — dismiss it immediately
  // instead of leaving the patient looking at an incoming call that no
  // longer exists.
  ;(async () => {
    try {
      const { data: row } = await supabase
        .from('consultations')
        .select('status')
        .eq('id', consultationId)
        .maybeSingle()
      if (row && row.status !== 'accepted') {
        logger.log('[VoIPPush] Stale incoming-call push for', consultationId, '— status is', row.status, '— dismissing')
        callkeep.reportCallEnded(uuid, 'answeredElsewhere')
      }
    } catch {
      // best effort
    }
  })()
}
