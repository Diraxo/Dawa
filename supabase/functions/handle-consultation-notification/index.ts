// Supabase Edge Function — handle-consultation-notification
// Called exclusively by database triggers (via pg_net, service-role key) when
// consultation events occur. This is the single source of truth for
// consultation notifications — clients must never call this function
// directly, or events will be double-sent (once by the client, once by the
// trigger that fires off the same status/row change).
//
// Events:
//   new_request    → notify DOCTOR  (patient entered waiting room, payment confirmed)
//   accepted       → notify PATIENT (doctor accepted, tap to join)
//                    For phone/video: ALSO sends system-level call push:
//                      iOS  → APNs VoIP push (triggers CallKit even when app is killed)
//                      Android → high-priority FCM data message (triggers ConnectionService)
//   declined       → notify PATIENT + DOCTOR (doctor declined — credit issued to patient)
//   summary_ready  → notify PATIENT (doctor submitted consultation notes)
//   summary_updated→ notify PATIENT (doctor edited an already-submitted summary)
//   review_received→ notify DOCTOR  (patient left a star rating)
//   missed_call    → notify DOCTOR  (patient didn't answer)
//   incoming_call  → internal alias for accepted on phone/video (same payload, explicit)
//   scheduled_booking → notify PATIENT + DOCTOR (payment succeeded for a future appointment)
//   rescheduled       → notify PATIENT + DOCTOR (patient moved an appointment to a new time)
//   completed         → notify PATIENT (doctor ended the consultation — distinct from summary_ready,
//                        which fires later once the doctor actually submits notes)
//   patient_joined    → notify DOCTOR  (patient's media connected — patient_connected_at set)
//   patient_left      → notify DOCTOR  (patient tapped "Leave Call" mid-consultation)
//   doctor_running_late → notify PATIENT (scheduled time arrived, doctor still occupied — fires once)
//   doctor_ready         → notify PATIENT (a previously-delayed consultation just activated)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push'

let vapidConfigured = false
function ensureVapidConfigured() {
  if (vapidConfigured) return
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@dawa.app', publicKey, privateKey)
  vapidConfigured = true
}

// Web-push counterpart to sendPushNotification (Expo) — delivers to browser
// subscriptions (carehub-web/public/sw.js + web_push_subscriptions table,
// migration 076) so patient/doctor web get every one of these event-driven
// notifications with the tab/browser fully closed, matching mobile's
// Expo/FCM/APNs coverage. Never throws — a failed browser push must not
// block the mobile push or the in-app notification row.
async function sendWebPush(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!userId) return
  ensureVapidConfigured()
  if (!vapidConfigured) return
  try {
    const { data: subs } = await supabase
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs || subs.length === 0) return
    await Promise.all(subs.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        )
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from('web_push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }))
  } catch (e) {
    console.warn('[WebPush] send failed:', e)
  }
}

// Mirrors carehub-web/components/ui/AppointmentAlerts.tsx's resolveUrl()
// switch so a background push and the in-app toast land on the same screen.
function patientPushUrl(screen: string, consultationId: string, consultationType: string): string {
  switch (screen) {
    case 'consultation': return `/patient/consultation/${consultationType}/${consultationId}`
    case 'consultation_summary': return `/patient/summary/${consultationId}`
    case 'waiting': return `/patient/waiting/${consultationId}`
    default: return '/patient/appointments'
  }
}

function doctorPushUrl(screen: string, consultationId: string): string {
  switch (screen) {
    case 'schedule': return '/doctor/schedule'
    case 'profile': return '/doctor/profile'
    default: return consultationId ? '/doctor/consultations' : '/doctor/home'
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ConsultationEvent =
  | 'new_request'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'missed_call'
  | 'call_declined'
  | 'summary_ready'
  | 'summary_updated'
  | 'review_received'
  | 'incoming_call'
  | 'scheduled_booking'
  | 'rescheduled'
  | 'completed'
  | 'patient_joined'
  | 'patient_left'
  | 'doctor_running_late'
  | 'doctor_ready'

interface Payload {
  event:           ConsultationEvent
  consultation_id: string
  rating?:         number
  repeat?:         boolean
}

const TYPE_LABEL: Record<string, string> = {
  chat:  'chat consultation',
  phone: 'phone consultation',
  video: 'video consultation',
}

// Notification titles for the two "here is your consultation" pushes — must
// never call every consultation a "call". "Chat with X" / "Voice
// Consultation with X" / "Video Consultation with X".
const NOTIF_TYPE_TITLE: Record<string, string> = {
  chat:  'Chat',
  phone: 'Voice Consultation',
  video: 'Video Consultation',
}

const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐']
const BUNDLE_ID = 'com.carehub.app'

// Doctor display names are free-text (`users.full_name`) and registration UI
// actively invites doctors to type "Dr." into that field, so any code that
// unconditionally prepends "Dr. " risks a double "Dr. Dr. Name". Strip an
// existing prefix first, then prepend exactly one — mirrors carehub-web's
// `stripDrPrefix()` (carehub-web/lib/utils.ts), which the client screens
// already rely on but this edge function did not.
function formatDoctorName(rawName: string | null | undefined, fallback: string): string {
  const name = (rawName ?? '').trim()
  if (!name) return fallback
  return `Dr. ${name.replace(/^Dr\.?\s+/i, '').trim()}`
}

// Appointment times are stored as timestamptz but represent a local
// Africa/Addis_Ababa wall-clock slot (see migration 054) — always render
// notification copy in that timezone, not the server/UTC one.
function formatLocalDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa', weekday: 'short', month: 'short', day: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
  return { date, time }
}

// Checks the recipient's notification_preferences row for a given category,
// defaulting to enabled if no row exists yet (matches the settings UI's
// defaults). Only gates the Expo push send — the in-app notification row and
// the system-level call push (FCM/VoIP, which actually rings the call) are
// never gated, since suppressing those would mean silently missing the
// consultation itself rather than just an informational ping.
type PushCategory =
  | 'consultation_request'
  | 'consultation_summary'
  | 'consultation_update'
  | 'reviews'

async function isPushEnabled(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  category: PushCategory,
): Promise<boolean> {
  if (!userId) return false
  const { data } = await supabase
    .from('notification_preferences')
    .select(category)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return true
  return (data as any)[category] !== false
}

// Real unread-notification count for this user, right now (including any
// row this call site is about to insert — callers insert first, then read
// this). Used as the push payload's badge so the OS badge always reflects
// actual unread state instead of a hardcoded 1. Clients own decrementing it
// as notifications get read (see lib/notificationCenter.ts) — this is only
// the value at send time.
async function getUnreadBadgeCount(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return 1
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 1
}

// Inserts an in-app notification row and returns its id so it can be threaded
// into the push payload's `data.notificationId` — lets the client mark the
// exact row read when the push is tapped (see app/_layout.tsx) instead of
// only being able to blanket-clear the whole badge.
async function insertNotification(
  supabase: ReturnType<typeof createClient>,
  row: { user_id: string; title: string; body: string; type: string; data_json: Record<string, unknown> },
): Promise<string | null> {
  const { data } = await supabase.from('notifications').insert(row).select('id').single()
  return (data as any)?.id ?? null
}

// ── Expo push (regular) ───────────────────────────────────────────────────────
// Expo's push API responds with a "ticket" per message — a 200 response does
// NOT mean the notification was delivered, only that Expo accepted it for
// delivery. A ticket's own `status` can still be "error" (bad credentials,
// stale token, malformed payload, etc). Previously this response was
// discarded entirely, so every silent failure — including a project with no
// working FCM v1 / APNs credentials configured in EAS — was invisible in
// logs. `recipient` (userId) lets a DeviceNotRegistered ticket clear the
// stale token so it stops being retried on every future event.

async function sendPushNotification(
  token:      string,
  title:      string,
  body:       string,
  data:       Record<string, unknown>,
  channel:    string = 'consultations',
  priority:   string = 'normal',
  imageUrl?:  string,
  supabase?:  ReturnType<typeof createClient>,
  recipient?: { userId: string; column: 'push_token' },
  badge:      number = 1,
  // `dedupeKey`, when given, is sent as both Expo's `tag` (Android — replaces
  // an already-displayed notification with the same tag; maps to FCM
  // notification.tag) and `collapseId` (Android: collapses same-key messages
  // still in transit via FCM collapse_key; iOS: ALSO replaces an
  // already-displayed notification via apns-collapse-id). Callers pass the
  // same key used by the client-side notification this push might duplicate
  // (e.g. Notifee's deterministic id for the same consultation event) so a
  // repeat send (migration 067's 3-min re-notify cron, FCM/Expo redelivery)
  // replaces the prior tray entry in place instead of stacking a second one.
  // This does not eliminate a duplicate between two independently-posted
  // notifications from different delivery transports (Notifee's own
  // background display vs this Expo-relayed one) — Android's tag/id identity
  // requires both the tag AND an internal numeric id to match, and Notifee's
  // id-hashing scheme for that numeric id is undocumented and unverified
  // without a physical device — see the dedup investigation notes in
  // index.js's 'incoming_request' branch for the full explanation.
  dedupeKey?: string,
) {
  const tag = `[ExpoPush:${(data as Record<string, unknown>)?.consultationId ?? '?'}]`
  console.log(`${tag} Sending, channel=${channel}, priority=${priority}, token=...${token.slice(-8)}`)

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'Accept':          'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify({
      to:        token,
      channelId: channel,
      title,
      body,
      data,
      sound:     'default',
      priority,
      badge,
      // Rich notification image (Android large icon / iOS attachment) — shows
      // the doctor's profile photo instead of the static app icon when set.
      ...(imageUrl ? { mutableContent: true, richContent: { image: imageUrl } } : {}),
      ...(dedupeKey ? { tag: dedupeKey, collapseId: dedupeKey } : {}),
    }),
  })

  if (!res.ok) {
    console.error(`${tag} Send request failed:`, res.status, await res.text().catch(() => ''))
    return
  }

  const json = await res.json().catch(() => null)
  const ticket = json?.data
  if (ticket?.status === 'error') {
    console.error(`${tag} Delivery error:`, ticket.message, ticket.details)
    if (ticket.details?.error === 'DeviceNotRegistered' && supabase && recipient) {
      console.warn(`${tag} Token is DeviceNotRegistered — clearing ${recipient.column} on user ${recipient.userId}`)
      await supabase.from('users').update({ [recipient.column]: null }).eq('id', recipient.userId)
    }
  } else {
    // Expo's ticket id lets you look up the actual receipt (delivered/error)
    // later via https://exp.host/--/api/v2/push/getReceipts — this ticket
    // being 'ok' only means Expo accepted the request, not that FCM/APNs
    // delivered it.
    console.log(`${tag} Expo accepted the push, ticket id:`, ticket?.id ?? '(none)')
  }
}

// ── Android FCM data message (triggers ConnectionService) ─────────────────────
// Uses FCM HTTP v1 API. Google fully decommissioned the legacy
// `https://fcm.googleapis.com/fcm/send` API (key-based auth) on June 20 2024 —
// any call to it now fails outright, regardless of what key is configured.
// v1 requires an OAuth2 access token minted from a Firebase service account.
// Secret required:
//   FCM_SERVICE_ACCOUNT_JSON — full contents of a Firebase service-account
//   key file (Firebase Console → Project settings → Service accounts →
//   Generate new private key), which also carries the project_id used in
//   the v1 endpoint URL.

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null

async function _getFCMAccessToken(): Promise<{ token: string; projectId: string } | null> {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!raw) {
    console.warn('[FCM] FCM_SERVICE_ACCOUNT_JSON not set — Android system call push skipped')
    return null
  }

  let account: { client_email: string; private_key: string; project_id: string }
  try {
    account = JSON.parse(raw)
  } catch {
    console.error('[FCM] FCM_SERVICE_ACCOUNT_JSON is not valid JSON')
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > now + 60) {
    return { token: cachedFcmAccessToken.token, projectId: account.project_id }
  }

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss:   account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }
  const signingInput = `${enc(header)}.${enc(claims)}`

  const keyDer = _pemToDer(account.private_key)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const jwtSig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const assertion = `${signingInput}.${jwtSig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!tokenRes.ok) {
    console.error('[FCM] OAuth token exchange failed:', tokenRes.status, await tokenRes.text())
    return null
  }

  const tokenJson = await tokenRes.json()
  cachedFcmAccessToken = {
    token:     tokenJson.access_token,
    expiresAt: now + (tokenJson.expires_in ?? 3600),
  }
  return { token: cachedFcmAccessToken.token, projectId: account.project_id }
}

// `recipient` lets a permanently-dead token (UNREGISTERED / NOT_FOUND — the
// device uninstalled the app or the token was never valid) get cleared so it
// isn't retried forever on every future call, mirroring what
// sendPushNotification already does for Expo's DeviceNotRegistered ticket.
async function sendFCMDataMessage(
  fcmToken:  string,
  data:      Record<string, string>,
  supabase?: ReturnType<typeof createClient>,
  recipient?: { userId: string; column: 'fcm_token' },
): Promise<boolean> {
  const tag = `[FCM:${data.consultationId ?? data.uuid ?? '?'}]`

  const auth = await _getFCMAccessToken()
  if (!auth) {
    console.error(`${tag} No FCM access token (missing/invalid FCM_SERVICE_ACCOUNT_JSON) — send aborted`)
    return false
  }

  console.log(`${tag} Sending data message, callType=${data.callType}, token=...${fcmToken.slice(-8)}`)

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          data,                          // data-only (no `notification` key) → headless task handles it
          android: {
            priority: 'high',            // wakes device from Doze mode
            ttl:      '60s',             // expires if not delivered quickly
          },
        },
      }),
    },
  )

  if (!res.ok) {
    const txt = await res.text()
    console.error(`${tag} Data message failed:`, res.status, txt)
    if (supabase && recipient) {
      const status = (() => { try { return JSON.parse(txt)?.error?.status } catch { return null } })()
      if (res.status === 404 || status === 'UNREGISTERED' || status === 'NOT_FOUND') {
        console.warn(`${tag} Token is UNREGISTERED/NOT_FOUND — clearing ${recipient.column} on user ${recipient.userId}`)
        await supabase.from('users').update({ [recipient.column]: null }).eq('id', recipient.userId)
      }
    }
    return false
  }
  // Firebase's v1 send response body is just `{ name: "projects/.../messages/<id>" }`
  // on success — logging it gives a concrete FCM message id to correlate against
  // Firebase console delivery logs when a push is accepted here but never shows
  // up on the device (the most common "silent notification" failure mode, which
  // happens entirely outside anything this server can observe).
  const json = await res.json().catch(() => null)
  console.log(`${tag} Firebase accepted the message:`, json?.name ?? '(no message id in response)')
  return true
}

// ── Best-effort "stop ringing" signal (Android FCM + iOS APNs VoIP) ────────────
// Sent (in addition to the normal notification for that event) whenever a
// ringing call-type consultation leaves the state its ring represents
// without the callee having answered from the OS call UI — e.g. a patient's
// ringing-after-accept call going missed/timed-out/cancelled, or a doctor's
// ringing on-demand/scheduled request being cancelled before they respond.
// Without this, a device whose CallKeep/ConnectionService incoming-call
// screen is still up has no way to learn the call is no longer valid until
// the OS's own ~60s ring timeout, which reads as a stray/ghost incoming call
// in the meantime. Works for either direction — the client only needs the
// uuid to end the right call.
//
// iOS previously had no equivalent at all (this was Android/FCM-only) — a
// doctor/patient on iOS whose CallKit screen was already ringing when the
// other party cancelled had no way to learn that short of the 60s CallKit
// timeout in lib/callkeep.ts. Mirrors the FCM-vs-VoIP fallback pattern used
// for the 'start' call-ring in send-appointment-notification.
async function sendCallCancelSignal(
  recipient: { fcm_token?: string | null; voip_token?: string | null },
  consultationId: string,
): Promise<void> {
  const payload = { callType: 'cancel_call', uuid: consultationId, consultationId }
  if (recipient.fcm_token) {
    try {
      await sendFCMDataMessage(recipient.fcm_token, payload)
      return
    } catch (e) {
      console.warn('[FCM] cancel_call signal failed:', e)
    }
  }
  if (recipient.voip_token) {
    try {
      await sendAPNsVoIPPush(recipient.voip_token, payload)
    } catch (e) {
      console.warn('[APNs] cancel_call signal failed:', e)
    }
  }
}

// ── iOS APNs VoIP push (triggers CallKit even when app is killed) ─────────────
// Uses APNs HTTP/2 API with JWT authentication.
// Secrets required (set via `supabase secrets set`):
//   APNS_KEY_ID      — 10-char key ID (from Apple Developer → Certificates → Keys)
//   APNS_TEAM_ID     — 10-char team ID (from Apple Developer → Membership)
//   APNS_PRIVATE_KEY — contents of the .p8 file (entire PEM including headers)

async function sendAPNsVoIPPush(
  voipToken: string,
  payload:   Record<string, unknown>,
  supabase?: ReturnType<typeof createClient>,
  recipient?: { userId: string; column: 'voip_token' },
): Promise<boolean> {
  const keyId      = Deno.env.get('APNS_KEY_ID')
  const teamId     = Deno.env.get('APNS_TEAM_ID')
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY')

  if (!keyId || !teamId || !privateKey) {
    console.warn('[APNs] VoIP push credentials not configured — iOS system call push skipped')
    console.warn('[APNs] Set APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY via supabase secrets set')
    return false
  }

  const tag = `[APNs:${payload.consultationId ?? '?'}]`
  try {
    const jwt = await _generateAPNsJWT(keyId, teamId, privateKey)
    console.log(`${tag} Sending VoIP push, token=...${voipToken.slice(-8)}`)

    const res = await fetch(
      `https://api.push.apple.com/3/device/${voipToken}`,
      {
        method: 'POST',
        headers: {
          'authorization':   `bearer ${jwt}`,
          'apns-push-type':  'voip',
          'apns-topic':      `${BUNDLE_ID}.voip`,
          'apns-expiration': '0',   // discard immediately if device is offline
          'apns-priority':   '10',  // immediate delivery
          'content-type':    'application/json',
        },
        body: JSON.stringify({ aps: {}, ...payload }),
      },
    )

    if (!res.ok) {
      const txt = await res.text()
      console.error(`${tag} VoIP push failed:`, res.status, txt)
      if (supabase && recipient) {
        const reason = (() => { try { return JSON.parse(txt)?.reason } catch { return null } })()
        if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
          console.warn(`${tag} Token is BadDeviceToken/Unregistered — clearing ${recipient.column} on user ${recipient.userId}`)
          await supabase.from('users').update({ [recipient.column]: null }).eq('id', recipient.userId)
        }
      }
      return false
    }
    console.log(`${tag} Apple accepted the VoIP push, apns-id:`, res.headers.get('apns-id') ?? '(none)')
    return true
  } catch (e) {
    console.error(`${tag} VoIP push error:`, e)
    return false
  }
}

// JWT signing for APNs (ES256 via Web Crypto API available in Deno)
async function _generateAPNsJWT(
  keyId:      string,
  teamId:     string,
  pemPrivKey: string,
): Promise<string> {
  const header  = { alg: 'ES256', kid: keyId }
  const now     = Math.floor(Date.now() / 1000)
  const claims  = { iss: teamId, iat: now }

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const signingInput = `${enc(header)}.${enc(claims)}`

  const keyDer = _pemToDer(pemPrivKey)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyDer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )

  // DER-encoded ECDSA signature → R||S (raw 64-byte format for JWT)
  const sigBytes = new Uint8Array(sigBuf)
  const rawSig   = _derToRawECDSA(sigBytes)

  const base64Sig = btoa(String.fromCharCode(...rawSig))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  return `${signingInput}.${base64Sig}`
}

function _pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN (?:EC |)PRIVATE KEY-----/, '')
    .replace(/-----END (?:EC |)PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

// Convert ASN.1 DER-encoded ECDSA signature to raw R||S format
function _derToRawECDSA(der: Uint8Array): Uint8Array {
  // DER SEQUENCE { INTEGER r, INTEGER s }
  let offset = 2 // skip SEQUENCE tag + length
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature')
  const rLen = der[offset + 1]
  offset += 2
  let r = der.slice(offset, offset + rLen)
  offset += rLen
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature')
  const sLen = der[offset + 1]
  offset += 2
  let s = der.slice(offset, offset + sLen)

  // DER integers may have a leading 0x00 padding byte — strip it
  if (r[0] === 0x00) r = r.slice(1)
  if (s[0] === 0x00) s = s.slice(1)

  // Pad to 32 bytes each
  const raw = new Uint8Array(64)
  raw.set(r, 32 - r.length)
  raw.set(s, 64 - s.length)
  return raw
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!bearerToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { event, consultation_id, rating } = payload
  if (!event || !consultation_id) {
    return new Response('Missing event or consultation_id', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Only the DB trigger (_call_consultation_notification) may call this
  // function, authenticating with a dedicated INTERNAL_NOTIFICATION_SECRET
  // via pg_net (not Supabase's platform-managed SUPABASE_SERVICE_ROLE_KEY,
  // which has silently changed format/value multiple times independent of
  // any action here and caused repeated 403s). This is deliberately not
  // open to client Clerk sessions: every event this function handles already
  // has a corresponding DB trigger, so a client-triggerable path would only
  // ever produce duplicate notifications.
  if (bearerToken !== Deno.env.get('INTERNAL_NOTIFICATION_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      waiting_started_at,
      scheduled_at,
      previous_scheduled_at,
      cancelled_by,
      consultation_credit,
      credit_amount,
      patient_amount,
      patient:users!patient_id (
        id, clerk_id, full_name, profile_photo_url, push_token, fcm_token, voip_token
      ),
      doctor_profile:doctor_profiles!doctor_id (
        specialty,
        user:users ( id, clerk_id, full_name, profile_photo_url, push_token, fcm_token, voip_token )
      )
    `)
    .eq('id', consultation_id)
    .single()

  if (error || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found', detail: error?.message }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const patient       = (consult.patient         as any) ?? {}
  const doctorProfile = (consult.doctor_profile  as any) ?? {}
  const doctorUser    = doctorProfile.user        ?? {}
  const typeLabel     = TYPE_LABEL[consult.type as string] ?? 'consultation'
  const isCallType    = consult.type === 'phone' || consult.type === 'video'

  const sharedData = {
    consultationId:   consultation_id,
    consultationType: consult.type,
    patientName:      patient.full_name    ?? '',
    patientId:        patient.id           ?? '',
    patientClerkId:   patient.clerk_id     ?? '',
    patientPhotoUrl:  patient.profile_photo_url ?? '',
    doctorName:       doctorUser.full_name ?? '',
    doctorId:         doctorUser.id        ?? '',
    doctorClerkId:    doctorUser.clerk_id  ?? '',
    doctorPhotoUrl:   doctorUser.profile_photo_url ?? '',
    doctorSpecialty:  doctorProfile.specialty  ?? '',
    agoraChannel:     consultation_id,
  }

  switch (event) {

    // ── Doctor: new consultation request ────────────────────────────────────
    case 'new_request': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = `${NOTIF_TYPE_TITLE[consult.type as string] ?? 'Consultation'} with ${patient.full_name ?? 'a patient'}`
      const body  = `Patient ${patient.full_name ?? 'A patient'} has paid and is waiting for your response.`
      // Push/tray text stays generic (no patient name) so it's safe to show
      // on a locked device — `title`/`body` above (with the real name) are
      // only used for the in-app notification row; the incoming-request
      // screen already reads the name from `sharedData` once opened.
      const pushTitle = `New ${NOTIF_TYPE_TITLE[consult.type as string] ?? 'Consultation'} Request`
      const pushBody  = 'A patient is waiting for your response. Open Dawa to review.'

      let notificationId: string | null = null
      if (doctorId) {
        // The 3-minute repeat cron (migration 067) re-fires this exact event
        // while the request sits unanswered — without this branch each tick
        // inserted a brand-new row, stacking 5+ "Incoming Consultation"
        // entries for one unanswered 15-minute wait. Refresh the existing
        // row's timestamp (and un-read it) instead of duplicating it.
        if (payload.repeat) {
          const { data: existing } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', doctorId)
            .eq('type', 'new_request')
            .contains('data_json', { consultationId: consultation_id })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (existing?.id) {
            await supabase.from('notifications')
              .update({ created_at: new Date().toISOString(), read_at: null })
              .eq('id', existing.id)
            notificationId = existing.id
          }
        }
        if (!notificationId) {
          notificationId = await insertNotification(supabase, {
            user_id:   doctorId,
            title,
            body,
            type:      'new_request',
            data_json: {
              ...sharedData,
              screen: 'incoming_request',
              waitingStartedAt: (consult as any).waiting_started_at ?? '',
            },
          })
        }
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendWebPush(supabase, doctorId, { title: pushTitle, body: pushBody, url: doctorPushUrl('incoming_request', consultation_id) })
      }

      // Doctor ring: Android → FCM data message triggers ConnectionService
      // (phone/video) or a full-screen Notifee alert (chat); iOS phone/video
      // → APNs VoIP triggers CallKit's native incoming-call UI (a live
      // audio/video consultation is a genuine VoIP call — CallKit's
      // incoming-call screen *is* the Accept/Decline UI, exactly what
      // PushKit VoIP is for). `direction: 'doctor'` tells the client the
      // caller is the *patient*, so it renders the correct name/photo and —
      // on Accept — opens the incoming-request screen (payment re-check,
      // decline-reason flow) instead of jumping straight into the call.
      // Neither data-only push displays anything if delivery itself fails
      // (bad/missing credentials, expired token, network error) — track
      // actual delivery so the VoIP attempt below only fires when FCM
      // didn't take. callRingDelivered only reflects "Google/Apple accepted
      // the HTTP request", never "the phone actually displayed something" —
      // Android silently defers or drops data-only FCM messages under Doze/
      // OEM battery managers even after a 200 response, with nothing left
      // client-side to report the miss back to the server. So unlike that
      // gate, the plain Expo push below (a real `notification`-type payload
      // FCM/APNs deliver to the tray unconditionally, no app code required)
      // always fires regardless of callRingDelivered — this is the doctor's
      // only alert for the single highest-stakes event in the app, and a
      // redundant heads-up notification alongside a working ring is a far
      // smaller cost than silence when the ring didn't actually show.
      console.log(
        `[Notify:${consultation_id}] Server stage — doctor=${doctorId}`,
        `fcm_token=${doctorUser.fcm_token ? 'present' : 'MISSING'}`,
        `voip_token=${doctorUser.voip_token ? 'present' : 'MISSING'}`,
        `push_token=${doctorToken ? 'present' : 'MISSING'}`,
        `isCallType=${isCallType}`,
      )
      let callRingDelivered = false
      if (doctorUser.fcm_token && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        callRingDelivered = isCallType
          ? await sendFCMDataMessage(doctorUser.fcm_token, {
              callType:         'incoming_call',
              direction:        'doctor',
              uuid:             consultation_id,
              consultationId:   consultation_id,
              consultationType: String(consult.type),
              patientName:      patient.full_name  ?? 'Patient',
              patientPhotoUrl:  patient.profile_photo_url ?? '',
              patientId:        patient.id         ?? '',
              patientClerkId:   patient.clerk_id   ?? '',
              doctorId:         doctorUser.id      ?? '',
              doctorClerkId:    doctorUser.clerk_id ?? '',
              agoraChannel:     consultation_id,
              waitingStartedAt: (consult as any).waiting_started_at ?? '',
            }, supabase, doctorId ? { userId: doctorId, column: 'fcm_token' } : undefined)
          : await sendFCMDataMessage(doctorUser.fcm_token, {
              callType:         'incoming_request',
              consultationId:   consultation_id,
              consultationType: String(consult.type),
              patientName:      patient.full_name  ?? 'Patient',
              patientId:        patient.id         ?? '',
              patientClerkId:   patient.clerk_id   ?? '',
              waitingStartedAt: (consult as any).waiting_started_at ?? '',
            }, supabase, doctorId ? { userId: doctorId, column: 'fcm_token' } : undefined)
      }
      if (!callRingDelivered && isCallType && doctorUser.voip_token && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        callRingDelivered = await sendAPNsVoIPPush(doctorUser.voip_token, {
          callType:         'incoming_call',
          direction:        'doctor',
          uuid:             consultation_id,
          consultationId:   consultation_id,
          consultationType: String(consult.type),
          patientName:      patient.full_name  ?? 'Patient',
          patientPhotoUrl:  patient.profile_photo_url ?? '',
          patientId:        patient.id         ?? '',
          patientClerkId:   patient.clerk_id   ?? '',
          doctorId:         doctorUser.id      ?? '',
          doctorClerkId:    doctorUser.clerk_id ?? '',
          agoraChannel:     consultation_id,
          waitingStartedAt: (consult as any).waiting_started_at ?? '',
        }, supabase, doctorId ? { userId: doctorId, column: 'voip_token' } : undefined)
      }
      const requestPushEnabled = await isPushEnabled(supabase, doctorId, 'consultation_request')
      if (doctorToken && requestPushEnabled) {
        console.log(`[Notify:${consultation_id}] Sending fallback Expo push (callRingDelivered=${callRingDelivered})`)
        await sendPushNotification(doctorToken, pushTitle, pushBody, {
          screen: 'incoming_request',
          // Lets the client's setNotificationHandler apply the same dedup
          // treatment this event's FCM data message already gets — without
          // this, a chat request's local/Notifee display and this fallback
          // stack as two separate tray notifications, and a phone/video
          // request's full-screen ConnectionService ring gets a redundant
          // heads-up banner on top of it (unlike the 'accepted' event's call
          // push, which has always set this).
          callType: isCallType ? 'incoming_call' : 'incoming_request',
          notificationId: notificationId ?? '',
          ...sharedData,
          waitingStartedAt: (consult as any).waiting_started_at ?? '',
        }, 'incoming_requests_v2', 'high', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId),
          // Matches Notifee's `id: incoming-request-${consultationId}` (see
          // index.js) and index.js's `android.tag` set on that same call —
          // best-effort cross-transport collapse (see sendPushNotification's
          // dedupeKey doc comment for why this isn't a guaranteed collapse).
          `incoming-request-${consultation_id}`)
      } else {
        console.log(`[Notify:${consultation_id}] Fallback Expo push SKIPPED — token=${!!doctorToken} prefEnabled=${requestPushEnabled}`)
      }

      await supabase
        .from('consultations')
        .update({ notification_sent: true })
        .eq('id', consultation_id)
      break
    }

    // ── Patient: doctor accepted ─────────────────────────────────────────────
    case 'accepted':
    case 'incoming_call': {
      const patientId     = patient.id          ?? null
      const patientToken  = patient.push_token  ?? null
      const patientFCM    = patient.fcm_token   ?? null
      const patientVoIP   = patient.voip_token  ?? null

      const title = `${NOTIF_TYPE_TITLE[consult.type as string] ?? 'Consultation'} with ${formatDoctorName(doctorUser.full_name, 'your doctor')}`
      const body  = isCallType
        ? `${formatDoctorName(doctorUser.full_name, 'Your doctor')} is calling. Tap to join.`
        : `${formatDoctorName(doctorUser.full_name, 'Your doctor')} is ready to chat. Tap to join.`

      // ── 1. Save in-app notification record ──────────────────────────────────
      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'accepted',
          data_json: {
            ...sharedData,
            screen: 'consultation',
          },
        })
      }

      // ── 2. For phone/video: send system-level call push first ───────────────
      if (isCallType) {
        const callData: Record<string, string> = {
          callType:         'incoming_call',
          uuid:             consultation_id,    // used as CallKeep uuid
          consultationId:   consultation_id,
          consultationType: String(consult.type),
          doctorName:       formatDoctorName(doctorUser.full_name, 'Doctor'),
          doctorSpecialty:  doctorProfile.specialty  ?? '',
          doctorPhotoUrl:   doctorUser.profile_photo_url  ?? '',
          doctorId:         doctorUser.id       ?? '',
          doctorClerkId:    doctorUser.clerk_id ?? '',
          patientClerkId:   patient.clerk_id    ?? '',
          agoraChannel:     consultation_id,
          screen:           'consultation',
        }

        // Android → FCM data message (high priority, no notification body)
        if (patientFCM) {
          await sendFCMDataMessage(patientFCM, callData, supabase, patientId ? { userId: patientId, column: 'fcm_token' } : undefined)
        }

        // iOS → APNs VoIP push (wakes app via PushKit → CallKit shows native UI)
        if (patientVoIP) {
          await sendAPNsVoIPPush(patientVoIP, callData, supabase, patientId ? { userId: patientId, column: 'voip_token' } : undefined)
        }
      }

      // ── 3. Expo push fallback (works when app is in background without call tokens) ─
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, {
          screen:          'consultation',
          callType:        isCallType ? 'incoming_call' : '',
          notificationId:  notificationId ?? '',
          ...sharedData,
        }, 'consultations', 'high', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId),
          `accepted-${consultation_id}`)
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('consultation', consultation_id, String(consult.type)) })
      }
      break
    }

    // ── Patient: doctor declined ─────────────────────────────────────────────
    case 'declined': {
      const creditAmount = Number((consult as any).credit_amount ?? (consult as any).patient_amount ?? 0)

      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const patientTitle = 'Consultation Unavailable'
      const patientBody  = `${formatDoctorName(doctorUser.full_name, 'The doctor')} is unavailable. Your consultation credit has been preserved. Please choose another doctor.`

      let patientNotifId: string | null = null
      if (patientId) {
        patientNotifId = await insertNotification(supabase, {
          user_id:   patientId,
          title:     patientTitle,
          body:      patientBody,
          type:      'declined',
          data_json: {
            ...sharedData,
            screen:                'appointments',
            consultationCredit:    true,
            creditAmount:          creditAmount.toString(),
            creditConsultationId:  consultation_id,
          },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen:               'appointments',
          consultationCredit:   true,
          creditAmount:         creditAmount.toString(),
          creditConsultationId: consultation_id,
          notificationId:       patientNotifId ?? '',
          ...sharedData,
        }, 'consultations', 'normal', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendWebPush(supabase, patientId, { title: patientTitle, body: patientBody, url: patientPushUrl('appointments', consultation_id, String(consult.type)) })
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'Consultation Request Closed'
      const doctorBody  = `The ${typeLabel} request from ${patient.full_name ?? 'a patient'} has ended.`
      const doctorPushBody = `A ${typeLabel} request has ended.`

      let doctorNotifId: string | null = null
      if (doctorId) {
        doctorNotifId = await insertNotification(supabase, {
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          type:      'declined',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      // "Consultation Updates" (not "Consultation Requests") is the toggle
      // that describes status changes/cancellations for the doctor — the
      // settings screen writes consultation_update, but every status-change
      // send here previously checked consultation_request instead, so that
      // toggle had no effect. Patient side has no equivalent column (only
      // consultation_request exists for patients), so it stays as-is.
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorPushBody, {
          screen: 'consultations',
          notificationId: doctorNotifId ?? '',
          ...sharedData,
        }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendWebPush(supabase, doctorId, { title: doctorTitle, body: doctorPushBody, url: doctorPushUrl('consultations', consultation_id) })
      }
      break
    }

    // ── Consultation cancelled (by patient, doctor, or admin) ────────────────
    // Whoever *initiated* the cancellation already knows it happened — they
    // must not get a push telling them their own action occurred. Only the
    // other party (who wasn't consulted) needs to be told. `cancelled_by`
    // (migration 040) records who did it; unknown/admin-initiated (null)
    // falls back to notifying both, same as before this fix existed.
    case 'cancelled': {
      const cancelledBy       = (consult as any).cancelled_by ?? null
      const patientId         = patient.id         ?? null
      const doctorId          = doctorUser.id      ?? null
      const cancelledByPatient = !!patientId && cancelledBy === patientId
      const cancelledByDoctor  = !!doctorId  && cancelledBy === doctorId

      // If this was a phone/video request, the other party's device may
      // still be mid-ring on the incoming-call UI — dismiss it immediately
      // instead of letting it ring out to its own ~60s timeout for a request
      // that no longer exists.
      if (isCallType) {
        await sendCallCancelSignal({ fcm_token: patient.fcm_token, voip_token: patient.voip_token }, consultation_id)
        await sendCallCancelSignal({ fcm_token: doctorUser.fcm_token, voip_token: doctorUser.voip_token }, consultation_id)
      }

      // ── Patient side — skipped entirely if the patient is the one who cancelled ──
      if (!cancelledByPatient) {
        const patientToken = patient.push_token ?? null
        const title = 'Consultation Cancelled'
        const body  = cancelledByDoctor
          ? `${formatDoctorName(doctorUser.full_name, 'Your doctor')} cancelled your consultation.`
          : `Your ${typeLabel} with ${formatDoctorName(doctorUser.full_name, 'your doctor')} has been cancelled.`

        let patientNotifId: string | null = null
        if (patientId) {
          patientNotifId = await insertNotification(supabase, {
            user_id:   patientId,
            title,
            body,
            type:      'cancelled',
            data_json: { ...sharedData, screen: 'appointments' },
          })
        }
        if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
          await sendPushNotification(patientToken, title, body, { screen: 'appointments', notificationId: patientNotifId ?? '', ...sharedData }, 'consultations', 'normal', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
        }
        if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
          await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('appointments', consultation_id, String(consult.type)) })
        }
      }

      // ── Doctor side — skipped entirely if the doctor is the one who cancelled ──
      // (no doctor-initiated cancel exists in the mobile app today, but this
      // keeps the rule symmetric for any future/admin path that sets
      // cancelled_by to the doctor's user id.)
      if (!cancelledByDoctor) {
        const doctorToken = doctorUser.push_token ?? null
        const doctorTitle = cancelledByPatient ? 'Appointment Cancelled' : 'Request Cancelled'
        const doctorBody  = cancelledByPatient
          ? `${patient.full_name ?? 'The patient'} cancelled the consultation.`
          : `${patient.full_name ?? 'The patient'} cancelled the ${typeLabel} request before you responded.`
        const doctorPushBody = cancelledByPatient
          ? 'A patient cancelled their consultation.'
          : `A ${typeLabel} request was cancelled before you responded.`

        let doctorNotifId: string | null = null
        if (doctorId) {
          doctorNotifId = await insertNotification(supabase, {
            user_id:   doctorId,
            title:     doctorTitle,
            body:      doctorBody,
            type:      'cancelled',
            data_json: { ...sharedData, screen: 'consultations' },
          })
        }
        if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
          await sendPushNotification(doctorToken, doctorTitle, doctorPushBody, { screen: 'consultations', notificationId: doctorNotifId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
        }
        if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
          await sendWebPush(supabase, doctorId, { title: doctorTitle, body: doctorPushBody, url: doctorPushUrl('consultations', consultation_id) })
        }
      }
      break
    }

    // ── Doctor: patient missed / declined ────────────────────────────────────
    case 'missed_call': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Missed Call'
      const body  = `${patient.full_name ?? 'A patient'} missed your ${typeLabel}. The request has been marked as missed.`
      const pushBody = `A patient missed your ${typeLabel}. The request has been marked as missed.`

      if (isCallType) await sendCallCancelSignal({ fcm_token: patient.fcm_token, voip_token: patient.voip_token }, consultation_id)

      let notificationId: string | null = null
      if (doctorId) {
        notificationId = await insertNotification(supabase, {
          user_id:   doctorId,
          title,
          body,
          type:      'missed_call',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendPushNotification(doctorToken, title, pushBody, { screen: 'consultations', notificationId: notificationId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendWebPush(supabase, doctorId, { title, body: pushBody, url: doctorPushUrl('consultations', consultation_id) })
      }
      break
    }

    // ── Doctor: patient explicitly declined the ringing call ────────────────
    case 'call_declined': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Call Declined'
      const body  = `${patient.full_name ?? 'The patient'} declined your ${typeLabel}.`
      const pushBody = `A patient declined your ${typeLabel}.`

      let notificationId: string | null = null
      if (doctorId) {
        notificationId = await insertNotification(supabase, {
          user_id:   doctorId,
          title,
          body,
          type:      'call_declined',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendPushNotification(doctorToken, title, pushBody, { screen: 'consultations', notificationId: notificationId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendWebPush(supabase, doctorId, { title, body: pushBody, url: doctorPushUrl('consultations', consultation_id) })
      }
      break
    }

    // ── Patient: consultation summary ready ──────────────────────────────────
    case 'summary_ready': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const doctorPhoto  = doctorUser.profile_photo_url || undefined
      const title = formatDoctorName(doctorUser.full_name, 'Your doctor')
      const body  = 'Your consultation summary is ready. Tap to view.'

      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'summary_ready',
          data_json: { ...sharedData, screen: 'consultation_summary' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_summary')) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'consultation_summary',
          notificationId: notificationId ?? '',
          ...sharedData,
        }, 'consultations', 'normal', doctorPhoto, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_summary')) {
        await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('consultation_summary', consultation_id, String(consult.type)) })
      }
      break
    }

    // ── Patient: consultation summary edited by doctor ───────────────────────
    case 'summary_updated': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const doctorPhoto  = doctorUser.profile_photo_url || undefined
      const title = formatDoctorName(doctorUser.full_name, 'Your doctor')
      // Distinct from summary_ready's wording — a patient who already read
      // the original summary needs to know this is a correction, not a copy
      // of the same "ready" push they already acted on.
      const body  = 'Your doctor updated your consultation summary. Tap to view the changes.'

      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'summary_updated',
          data_json: { ...sharedData, screen: 'consultation_summary' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_summary')) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'consultation_summary',
          notificationId: notificationId ?? '',
          ...sharedData,
        }, 'consultations', 'normal', doctorPhoto, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_summary')) {
        await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('consultation_summary', consultation_id, String(consult.type)) })
      }
      break
    }

    // ── Doctor: new star rating received ────────────────────────────────────
    case 'review_received': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'New Rating Received'
      const body  = `${patient.full_name ?? 'A patient'} rated your consultation ${STARS[Math.min(rating ?? 5, 5)]}`
      const pushBody = `A patient rated your consultation ${STARS[Math.min(rating ?? 5, 5)]}`

      let notificationId: string | null = null
      if (doctorId) {
        // `notifKind: 'rating'` is additive on top of the existing
        // `screen: 'profile'` (kept unchanged so carehub-web's resolveUrl()/
        // doctorPushUrl() — which only understand `screen` — keep routing to
        // /doctor/profile exactly as before). Only the mobile app's
        // navigateForNotification() reads notifKind, to route straight to
        // Profile → My Ratings instead of the generic profile tab.
        notificationId = await insertNotification(supabase, {
          user_id:   doctorId,
          title,
          body,
          type:      'review_received',
          data_json: { ...sharedData, screen: 'profile', notifKind: 'rating' },
        })
      }
      // Previously sent unconditionally — the "New Patient Reviews" toggle
      // had no effect at all. Gate on 'reviews', matching the settings screen.
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'reviews')) {
        await sendPushNotification(doctorToken, title, pushBody, { screen: 'profile', notifKind: 'rating', notificationId: notificationId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'reviews')) {
        await sendWebPush(supabase, doctorId, { title, body: pushBody, url: doctorPushUrl('profile', consultation_id) })
      }
      break
    }

    // ── Patient + Doctor: payment succeeded for a future appointment ─────────
    case 'scheduled_booking': {
      const { date, time } = formatLocalDateTime((consult as any).scheduled_at)

      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const patientTitle = 'Appointment Scheduled'
      const patientBody  = `Your ${typeLabel} with ${formatDoctorName(doctorUser.full_name, 'your doctor')} is scheduled for ${date} at ${time}.`

      let patientNotifId: string | null = null
      if (patientId) {
        patientNotifId = await insertNotification(supabase, {
          user_id:   patientId,
          title:     patientTitle,
          body:      patientBody,
          type:      'scheduled_booking',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen: 'appointments', notificationId: patientNotifId ?? '', ...sharedData,
        }, 'consultations', 'normal', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendWebPush(supabase, patientId, { title: patientTitle, body: patientBody, url: patientPushUrl('appointments', consultation_id, String(consult.type)) })
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'New Scheduled Appointment'
      const doctorBody  = `${patient.full_name ?? 'A patient'} booked a ${typeLabel} for ${date} at ${time}.`
      const doctorPushBody = `A patient booked a ${typeLabel} for ${date} at ${time}.`

      let doctorNotifId: string | null = null
      if (doctorId) {
        doctorNotifId = await insertNotification(supabase, {
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          // 'schedule' (not 'consultations') — the Consultations list's
          // "incoming" bucket only surfaces waiting_for_doctor/pending rows,
          // so a freshly booked 'scheduled' appointment opened there was
          // unclickable dead weight. Schedule is the doctor's actual
          // upcoming-appointments view (see Issue 5/6 fix).
          type:      'scheduled_booking',
          data_json: { ...sharedData, screen: 'schedule' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorPushBody, {
          screen: 'schedule', notificationId: doctorNotifId ?? '', ...sharedData,
        }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      if (doctorId && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendWebPush(supabase, doctorId, { title: doctorTitle, body: doctorPushBody, url: doctorPushUrl('schedule', consultation_id) })
      }

      // A booking made less than 10 minutes before its own slot never passes
      // through the 30-minute cron window (and may miss the 10-minute one too)
      // — send the "starting soon" reminder right now instead, and pre-mark
      // every tier sent so trigger_appointment_reminders() doesn't redundantly
      // (and harmlessly, but pointlessly) attempt them. The at-scheduled-time
      // "start" push still fires separately once scheduled_at arrives,
      // satisfying "notify again exactly at consultation start" for this case
      // too. Threshold matches the spec's "5 minutes before (only if
      // appointment is less than 10 minutes away when booked)".
      const minutesUntilStart = ((consult as any).scheduled_at
        ? (new Date((consult as any).scheduled_at).getTime() - Date.now()) / 60000
        : Infinity)
      if (minutesUntilStart < 10) {
        const soonTitle = 'Consultation Starting Soon'
        const patientSoonBody = `Your consultation begins in ${Math.max(0, Math.round(minutesUntilStart))} minutes.`
        const doctorSoonBody  = 'Prepare for your consultation.'

        if (patientId) {
          await insertNotification(supabase, {
            user_id: patientId, title: soonTitle, body: patientSoonBody,
            type: 'appointment_reminder', data_json: { ...sharedData, screen: 'appointments' },
          })
        }
        if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
          await sendPushNotification(patientToken, soonTitle, patientSoonBody, {
            screen: 'appointments', ...sharedData,
          }, 'consultations', 'normal', undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
        }
        if (doctorId) {
          await insertNotification(supabase, {
            user_id: doctorId, title: soonTitle, body: doctorSoonBody,
            type: 'appointment_reminder', data_json: { ...sharedData, screen: 'schedule' },
          })
        }
        if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
          await sendPushNotification(doctorToken, soonTitle, doctorSoonBody, {
            screen: 'schedule', ...sharedData,
          }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
        }

        await supabase.from('consultations').update({
          reminder_30_sent: true, reminder_10_sent: true, reminder_5_sent: true,
        }).eq('id', consultation_id)
      }
      break
    }

    // ── Patient + Doctor: appointment moved to a new time ────────────────────
    case 'rescheduled': {
      const { date, time } = formatLocalDateTime((consult as any).scheduled_at)

      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const patientTitle = 'Appointment Rescheduled'
      const patientBody  = `Your appointment with ${formatDoctorName(doctorUser.full_name, 'your doctor')} has been rescheduled to ${date} at ${time}.`

      let patientNotifId: string | null = null
      if (patientId) {
        patientNotifId = await insertNotification(supabase, {
          user_id:   patientId,
          title:     patientTitle,
          body:      patientBody,
          type:      'rescheduled',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen: 'appointments', notificationId: patientNotifId ?? '', ...sharedData,
        }, 'consultations', 'normal', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'Appointment Rescheduled'
      const doctorBody  = `${patient.full_name ?? 'A patient'} rescheduled their ${typeLabel} to ${date} at ${time}.`
      const doctorPushBody = `A patient rescheduled their ${typeLabel} to ${date} at ${time}.`

      let doctorNotifId: string | null = null
      if (doctorId) {
        doctorNotifId = await insertNotification(supabase, {
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          type:      'rescheduled',
          data_json: { ...sharedData, screen: 'schedule' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorPushBody, {
          screen: 'schedule', notificationId: doctorNotifId ?? '', ...sharedData,
        }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      break
    }

    // ── Patient: doctor ended the consultation ───────────────────────────────
    case 'completed': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const doctorPhoto  = doctorUser.profile_photo_url || undefined
      const title = 'Consultation Completed'
      const body  = `Your ${typeLabel} with ${formatDoctorName(doctorUser.full_name, 'your doctor')} has ended.`

      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'completed',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'appointments', notificationId: notificationId ?? '', ...sharedData,
        }, 'consultations', 'normal', doctorPhoto, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      break
    }

    // ── Doctor: patient's media connected ────────────────────────────────────
    case 'patient_joined': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Patient Joined'
      const body  = `${patient.full_name ?? 'The patient'} has joined the ${typeLabel}.`
      const pushBody = `A patient has joined the ${typeLabel}.`

      let notificationId: string | null = null
      if (doctorId) {
        notificationId = await insertNotification(supabase, {
          user_id:   doctorId,
          title,
          body,
          type:      'patient_joined',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendPushNotification(doctorToken, title, pushBody, { screen: 'consultations', notificationId: notificationId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      break
    }

    // ── Doctor: patient left mid-consultation (call stays active) ──────────
    case 'patient_left': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Patient Left'
      const body  = `${patient.full_name ?? 'The patient'} has left the ${typeLabel}.`
      const pushBody = `A patient has left the ${typeLabel}.`

      let notificationId: string | null = null
      if (doctorId) {
        notificationId = await insertNotification(supabase, {
          user_id:   doctorId,
          title,
          body,
          type:      'patient_left',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_update')) {
        await sendPushNotification(doctorToken, title, pushBody, { screen: 'consultations', notificationId: notificationId ?? '', ...sharedData }, 'consultations', 'normal', undefined, supabase, { userId: doctorId, column: 'push_token' }, await getUnreadBadgeCount(supabase, doctorId))
      }
      break
    }

    // ── Patient: scheduled time arrived, doctor still occupied elsewhere ────
    // Fires exactly once per delayed consultation (running_late_notified
    // guard lives in the cron function that calls this — migration 084).
    case 'doctor_running_late': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Doctor Running Behind'
      const body  = `${formatDoctorName(doctorUser.full_name, 'Your doctor')} is still completing another consultation. We'll notify you as soon as your consultation is ready.`

      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'doctor_running_late',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'appointments', notificationId: notificationId ?? '', ...sharedData,
        }, 'consultations', 'normal', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('appointments', consultation_id, String(consult.type)) })
      }
      break
    }

    // ── Patient: a previously-delayed consultation just activated ───────────
    case 'doctor_ready': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Your Doctor Is Ready'
      const body  = `${formatDoctorName(doctorUser.full_name, 'Your doctor')} is now available. Tap to join.`

      let notificationId: string | null = null
      if (patientId) {
        notificationId = await insertNotification(supabase, {
          user_id:   patientId,
          title,
          body,
          type:      'doctor_ready',
          data_json: { ...sharedData, screen: 'waiting' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'waiting', notificationId: notificationId ?? '', ...sharedData,
        }, 'consultations', 'high', doctorUser.profile_photo_url || undefined, supabase, { userId: patientId, column: 'push_token' }, await getUnreadBadgeCount(supabase, patientId))
      }
      if (patientId && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendWebPush(supabase, patientId, { title, body, url: patientPushUrl('waiting', consultation_id, String(consult.type)) })
      }
      break
    }

    default:
      return new Response('Unknown event type', { status: 400, headers: corsHeaders })
  }

  return new Response(
    JSON.stringify({ event, sent: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
