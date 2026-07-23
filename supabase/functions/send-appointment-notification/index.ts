// Supabase Edge Function — send-appointment-notification
// Triggered by pg_cron:
//   - kind "reminder_30" / "reminder_10" / "reminder_5" → 30 / 10 / 5 minutes
//     before scheduled_at
//   - kind "reminder"     → legacy ~15-minute-before tier (kept for any
//     in-flight rows scheduled before this function was updated)
//   - kind "start"        → at scheduled_at (±30 seconds)
//   - kind "followup"     → a doctor-scheduled follow-up reminder is due
//     (looks up `followup_reminders` via `reminder_id` instead of
//     `appointment_id`)
// Sends an Expo push notification (FCM on Android, APNs on iOS) to both the
// patient and the doctor, and inserts a row into the notifications table for
// each so the website can display the same alert.

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

// Web-push counterpart to sendExpoPush — delivers to browser subscriptions
// (carehub-web/public/sw.js + web_push_subscriptions table, migration 076) so
// patient/doctor web get real notifications with the tab/browser fully
// closed, matching mobile's Expo/FCM/APNs coverage.
async function sendWebPush(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  payload: { title: string; body: string; url: string },
): Promise<number> {
  if (!userId) return 0
  ensureVapidConfigured()
  if (!vapidConfigured) return 0
  const { data: subs } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs || subs.length === 0) return 0
  let sent = 0
  await Promise.all(subs.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
      sent += 1
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from('web_push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }))
  return sent
}

interface Payload {
  appointment_id?: string
  reminder_id?: string
  kind?: 'reminder' | 'reminder_30' | 'reminder_10' | 'reminder_5' | 'start' | 'followup'
}

// Doctor display names are free-text (`users.full_name`) and registration UI
// actively invites doctors to type "Dr." into that field, so unconditionally
// prepending "Dr. " risks a double "Dr. Dr. Name" — mirrors
// handle-consultation-notification's formatDoctorName().
function formatDoctorName(rawName: string | null | undefined, fallback: string): string {
  const name = (rawName ?? '').trim()
  if (!name) return fallback
  return `Dr. ${name.replace(/^Dr\.?\s+/i, '').trim()}`
}

function pushMessage(
  pushToken: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  imageUrl?: string,
  badge: number = 1,
  // See handle-consultation-notification's sendPushNotification() dedupeKey
  // doc comment — same Expo `tag`/`collapseId` mechanism, applied here so a
  // redelivered/retried cron push for the same reminder tier replaces its
  // prior tray entry instead of stacking a second one.
  dedupeKey?: string,
) {
  return {
    to: pushToken,
    channelId: 'appointments',
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    badge,
    // Rich notification image (Android large icon / iOS attachment) — shows
    // the doctor's profile photo instead of the static app icon when set.
    ...(imageUrl ? { mutableContent: true, richContent: { image: imageUrl } } : {}),
    ...(dedupeKey ? { tag: dedupeKey, collapseId: dedupeKey } : {}),
  }
}

// Real unread-notification count for this user, right now — mirrors
// handle-consultation-notification's getUnreadBadgeCount so both edge
// functions set an accurate OS badge instead of a hardcoded 1.
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

// Mirrors handle-consultation-notification's insertNotification — returns
// the row id so it can be threaded into the push payload's
// data.notificationId, letting the client mark the exact row read on tap.
async function insertNotification(
  supabase: ReturnType<typeof createClient>,
  row: { user_id: string; title: string; body: string; type: string; data_json: Record<string, unknown> },
): Promise<string | null> {
  const { data } = await supabase.from('notifications').insert(row).select('id').single()
  return (data as any)?.id ?? null
}

// Checks the recipient's notification_preferences row for a given category,
// defaulting to enabled if no row exists yet (matches the settings UI's
// defaults). Only gates the push send, never the in-app notification row.
async function isPushEnabled(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  category: 'appointment_reminder',
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

// ── Android FCM data message (triggers the doctor's full-screen incoming-
// request alert via index.js's background handler) ──────────────────────
// A *scheduled* consultation reaching its start time is functionally the
// same "doctor must respond now" moment as an on-demand new_request in
// handle-consultation-notification — but previously only got a plain Expo
// push here, so a scheduled phone/video consultation never rang the
// doctor's device the way an on-demand one does. Mirrors that file's
// sendFCMDataMessage()/_getFCMAccessToken() (FCM HTTP v1 — the legacy
// fcm.googleapis.com/fcm/send API was decommissioned June 2024) exactly;
// duplicated rather than shared since these are independently deployed
// edge functions with no shared-module path in this project.
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

  const b64 = account.private_key
    .replace(/-----BEGIN (?:EC |)PRIVATE KEY-----/, '')
    .replace(/-----END (?:EC |)PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const keyBuf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) keyBuf[i] = bin.charCodeAt(i)

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuf.buffer,
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
          data,
          android: { priority: 'high', ttl: '60s' },
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
  const json = await res.json().catch(() => null)
  console.log(`${tag} Firebase accepted the message:`, json?.name ?? '(no message id in response)')
  return true
}

// ── iOS APNs VoIP push (triggers CallKit even when app is killed) ─────────────
// Mirrors handle-consultation-notification's sendAPNsVoIPPush/_generateAPNsJWT
// exactly (duplicated, not shared — see the FCM helpers above for why).
// Secrets required (set via `supabase secrets set`):
//   APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY
const BUNDLE_ID = 'com.carehub.app'

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
    return false
  }

  try {
    const jwt = await _generateAPNsJWT(keyId, teamId, privateKey)

    const res = await fetch(
      `https://api.push.apple.com/3/device/${voipToken}`,
      {
        method: 'POST',
        headers: {
          'authorization':   `bearer ${jwt}`,
          'apns-push-type':  'voip',
          'apns-topic':      `${BUNDLE_ID}.voip`,
          'apns-expiration': '0',
          'apns-priority':   '10',
          'content-type':    'application/json',
        },
        body: JSON.stringify({ aps: {}, ...payload }),
      },
    )

    if (!res.ok) {
      const txt = await res.text()
      console.error('[APNs] VoIP push failed:', res.status, txt)
      if (supabase && recipient) {
        const reason = (() => { try { return JSON.parse(txt)?.reason } catch { return null } })()
        if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
          await supabase.from('users').update({ [recipient.column]: null }).eq('id', recipient.userId)
        }
      }
      return false
    }
    console.log('[APNs] VoIP push sent successfully')
    return true
  } catch (e) {
    console.error('[APNs] VoIP push error:', e)
    return false
  }
}

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
  let offset = 2
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature')
  const rLen = der[offset + 1]
  offset += 2
  let r = der.slice(offset, offset + rLen)
  offset += rLen
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature')
  const sLen = der[offset + 1]
  offset += 2
  let s = der.slice(offset, offset + sLen)

  if (r[0] === 0x00) r = r.slice(1)
  if (s[0] === 0x00) s = s.slice(1)

  const raw = new Uint8Array(64)
  raw.set(r, 32 - r.length)
  raw.set(s, 64 - s.length)
  return raw
}

async function sendExpoPush(messages: object[]): Promise<unknown> {
  if (messages.length === 0) return null
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  })
  if (!res.ok) {
    console.error('[ExpoPush] Send request failed:', res.status, await res.text().catch(() => ''))
    return null
  }
  return res.json()
}

// A 200 from Expo's push endpoint only means the batch was accepted — each
// message gets its own "ticket" in `expoResult.data`, in the same order the
// messages were sent, and a ticket's own `status` can still be "error" (bad
// credentials, stale token, malformed payload). This previously went
// entirely unchecked, so failures were invisible in logs. `recipients` must
// be built in the exact same push order as `messages` so tickets line up;
// a DeviceNotRegistered ticket clears the stale token so it isn't retried
// on every future reminder/start push for that user.
async function logExpoPushErrors(
  supabase:   ReturnType<typeof createClient>,
  expoResult: unknown,
  recipients: Array<{ userId: string }>,
): Promise<void> {
  const tickets = (expoResult as any)?.data
  if (!Array.isArray(tickets)) return
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]
    if (ticket?.status !== 'error') continue
    console.error('[ExpoPush] Delivery error:', ticket.message, ticket.details)
    const recipient = recipients[i]
    if (ticket.details?.error === 'DeviceNotRegistered' && recipient) {
      await supabase.from('users').update({ push_token: null }).eq('id', recipient.userId)
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // This function is only ever legitimately invoked by pg_cron (via pg_net,
  // authenticating with a dedicated INTERNAL_NOTIFICATION_SECRET vault entry
  // — not Supabase's platform-managed SUPABASE_SERVICE_ROLE_KEY, which has
  // silently changed format/value multiple times and caused repeated 403s)
  // — there is no direct client caller. Reject anything else; otherwise
  // anyone who reaches this URL could spam real push notifications, or mark
  // a row as sent to suppress the real reminder.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (bearerToken !== Deno.env.get('INTERNAL_NOTIFICATION_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { appointment_id, reminder_id, kind = 'start' } = payload

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Follow-up reminder (doctor-scheduled, from consultation-summary) ──────
  if (kind === 'followup') {
    if (!reminder_id) return new Response('Missing reminder_id', { status: 400 })

    const { data: reminder, error } = await supabase
      .from('followup_reminders')
      .select(`
        id, sent, message, consultation_id,
        patient:users!patient_id ( id, full_name, push_token ),
        doctor:doctor_profiles!doctor_id ( user:users ( id, full_name, profile_photo_url, push_token ) )
      `)
      .eq('id', reminder_id)
      .single()

    if (error || !reminder) {
      return new Response(JSON.stringify({ error: 'Reminder not found', detail: error?.message }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (reminder.sent) {
      return new Response(JSON.stringify({ skipped: true, reason: 'already_sent' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    const patient = (reminder.patient as any) ?? {}
    const doctorUser = (reminder.doctor as any)?.user ?? {}
    const doctorPhoto = doctorUser.profile_photo_url || undefined
    const title = 'Follow-up Reminder'
    // In-app (Notification Center) body preserves the doctor's actual note —
    // it's only visible after the patient authenticates into the app.
    const inAppBody = reminder.message?.trim()
      ? reminder.message
      : `${formatDoctorName(doctorUser.full_name, 'Your doctor')} scheduled a follow-up reminder for you.`
    // Push/lock-screen body is deliberately generic regardless of what the
    // doctor wrote — a free-text clinical note (medication names, diagnosis
    // detail, etc.) must never surface outside the authenticated app.
    const pushBody = `${formatDoctorName(doctorUser.full_name, 'Your doctor')} has a follow-up reminder for you. Tap to view.`
    // 'consultation_summary' (underscore) matches the existing deep-link
    // switch in app/_layout.tsx — opens app/(patient)/consultation-summary.tsx.
    const data = { screen: 'consultation_summary', consultationId: reminder.consultation_id, reminderId: reminder.id }

    let notificationId: string | null = null
    if (patient.id) {
      notificationId = await insertNotification(supabase, {
        user_id: patient.id, type: 'followup_reminder', title, body: inAppBody,
        data_json: { consultation_id: reminder.consultation_id, reminder_id: reminder.id },
      })
    }

    const messages: object[] = []
    const recipients: Array<{ userId: string }> = []
    if (patient.push_token && await isPushEnabled(supabase, patient.id, 'appointment_reminder')) {
      messages.push(pushMessage(
        patient.push_token, title, pushBody, { ...data, notificationId: notificationId ?? '' }, doctorPhoto,
        await getUnreadBadgeCount(supabase, patient.id),
        `followup-${reminder_id}`,
      ))
      recipients.push({ userId: patient.id })
    }
    const expoResult = await sendExpoPush(messages)
    await logExpoPushErrors(supabase, expoResult, recipients)
    const webPushSent = await sendWebPush(supabase, patient.id, { title, body: pushBody, url: `/patient/summary/${reminder.consultation_id}` })

    await supabase.from('followup_reminders').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', reminder_id)

    return new Response(
      JSON.stringify({ kind, push_sent: messages.length, web_push_sent: webPushSent, expo: expoResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── Appointment start / pre-consultation reminder tiers ────────────────────
  if (!appointment_id) {
    return new Response('Missing appointment_id', { status: 400 })
  }

  // consultations.doctor_id → doctor_profiles.id → users
  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      scheduled_at,
      notification_sent,
      reminder_sent,
      reminder_30_sent,
      reminder_10_sent,
      reminder_5_sent,
      patient:users!patient_id ( id, clerk_id, full_name, push_token ),
      doctor_profile:doctor_profiles!doctor_id (
        user:users ( id, clerk_id, full_name, profile_photo_url, push_token, fcm_token, voip_token )
      )
    `)
    .eq('id', appointment_id)
    .single()

  if (error || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found', detail: error?.message }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Guard: do not send the same kind twice
  const alreadySentByKind: Record<string, boolean> = {
    reminder: !!consult.reminder_sent,
    reminder_30: !!consult.reminder_30_sent,
    reminder_10: !!consult.reminder_10_sent,
    reminder_5: !!consult.reminder_5_sent,
    start: !!consult.notification_sent,
  }
  if (alreadySentByKind[kind]) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'already_sent' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const patient = (consult.patient as any) ?? {}
  const doctorUser = (consult.doctor_profile as any)?.user ?? {}
  const doctorPhoto = doctorUser.profile_photo_url || undefined

  const isReminder = kind === 'reminder' || kind === 'reminder_30' || kind === 'reminder_10' || kind === 'reminder_5'
  const minutesOut = kind === 'reminder_30' ? 30 : kind === 'reminder_10' ? 10 : kind === 'reminder_5' ? 5 : 15

  const TYPE_LABEL: Record<string, string> = { chat: 'Chat Consultation', phone: 'Voice Consultation', video: 'Video Consultation' }
  const typeLabel = TYPE_LABEL[consult.type] ?? 'Consultation'
  const doctorDisplayName = formatDoctorName(doctorUser.full_name, 'your doctor')
  const patientDisplayName = (patient.full_name ?? '').trim() || 'your patient'

  // Copy matches the release-blocker spec verbatim, per role and per tier —
  // every tier gets distinct wording naming the *other* party and the
  // consultation type, instead of a single generic template shared across
  // tiers/roles (previously all 3 reminder tiers used identical text with no
  // name/type, and 'start' text was reused from "New consultation request").
  const title = kind === 'reminder_30' || kind === 'reminder_10'
    ? 'Upcoming Consultation'
    : kind === 'reminder_5' || kind === 'reminder'
      ? 'Consultation Starting Soon'
      : 'Consultation Ready' // overridden per-role below for kind === 'start'
  const patientTitle = kind === 'start' ? 'Consultation Starting' : title
  const doctorTitle = kind === 'start' ? 'Incoming Consultation' : title
  const patientBody = kind === 'reminder_30' || kind === 'reminder_10'
    ? `${minutesOut} minutes remaining until your ${typeLabel} with ${doctorDisplayName}.`
    : kind === 'reminder_5' || kind === 'reminder'
      ? 'Get ready for your consultation.'
      // Status is still only waiting_for_doctor at fire time (the doctor
      // hasn't accepted yet) — this must not claim the call is joinable
      // (see Issue 7), so it matches the waiting-room deep-link below.
      : kind === 'start' ? 'Your consultation is starting. Waiting for your doctor…' : 'Your consultation is ready.'
  const doctorBody = kind === 'reminder_30' || kind === 'reminder_10'
    ? `${minutesOut} minutes remaining until your ${typeLabel} with ${patientDisplayName}.`
    : kind === 'reminder_5' || kind === 'reminder'
      ? 'Get ready for your consultation.'
      : kind === 'start' ? 'Patient is ready. Accept or Decline.' : 'Your scheduled consultation is ready.'
  // Push/lock-screen body drops the patient's name (in-app notification row
  // above keeps it) — same rationale as the followup-reminder generic body.
  const doctorPushBody = kind === 'reminder_30' || kind === 'reminder_10'
    ? `${minutesOut} minutes remaining until your ${typeLabel} with a patient.`
    : doctorBody

  // At 'start' the cron has only just flipped status to waiting_for_doctor —
  // the doctor hasn't accepted yet, so the patient's deep link must land in
  // the waiting room (which live-checks status and only then routes into the
  // actual call), not directly on the consultation screen implying it's
  // already joinable (see Issue 7).
  const patientDeepLinkData = isReminder
    ? { screen: 'appointments', consultationId: appointment_id, consultationType: consult.type }
    : {
        screen: 'waiting',
        consultationId: appointment_id,
        consultationType: consult.type,
        doctorName: doctorUser.full_name ?? '',
        doctorId:   doctorUser.id        ?? '',
      }

  // 1. Insert in-app notification rows (read by mobile + website), capturing
  // each id so it can be threaded into that recipient's push payload below.
  let patientNotificationId: string | null = null
  let doctorNotificationId: string | null = null
  if (patient.id) {
    patientNotificationId = await insertNotification(supabase, {
      user_id: patient.id,
      title: patientTitle,
      body: patientBody,
      type: isReminder ? 'appointment_reminder' : 'appointment_start',
      data_json: patientDeepLinkData,
    })
  }
  if (doctorUser.id) {
    doctorNotificationId = await insertNotification(supabase, {
      user_id: doctorUser.id,
      title: doctorTitle,
      body: doctorBody,
      type: isReminder ? 'appointment_reminder' : 'appointment_start',
      data_json: { screen: 'consultations', consultationId: appointment_id, consultationType: consult.type },
    })
  }
  const notificationRows = [patientNotificationId, doctorNotificationId].filter(Boolean)

  // 2. Send push notifications via Expo Push API (mobile) and Web Push (browser)
  const messages: object[] = []
  const recipients: Array<{ userId: string }> = []
  if (patient.push_token && await isPushEnabled(supabase, patient.id, 'appointment_reminder')) {
    messages.push(pushMessage(
      patient.push_token, patientTitle, patientBody,
      { ...patientDeepLinkData, notificationId: patientNotificationId ?? '' },
      doctorPhoto,
      await getUnreadBadgeCount(supabase, patient.id),
      `appt-${appointment_id}-${kind}-patient`,
    ))
    recipients.push({ userId: patient.id })
  }
  // A scheduled phone/video consultation reaching its start time is the same
  // "doctor must respond now" moment as an on-demand new_request in
  // handle-consultation-notification — mirror that file's ConnectionService/
  // CallKit ring exactly: callType 'incoming_call' + direction 'doctor' (not
  // 'incoming_request', which only raises a one-shot Notifee alert, not the
  // continuous native ring the spec requires for phone/video). Android via
  // FCM data message, iOS via APNs VoIP. The plain Expo push below always
  // fires too, regardless of whether the ring "delivered" — doctorFcmDelivered
  // only means FCM/APNs accepted the HTTP request, not that the phone
  // actually displayed the ring (Android can silently drop a data-only
  // message under Doze/OEM battery restrictions with no way to report that
  // back here), so it isn't a safe signal to skip the one alert guaranteed
  // to reach the tray without any app code running.
  console.log(
    `[Notify:${appointment_id}] Server stage (start-ring) — doctor=${doctorUser.id}`,
    `kind=${kind}, type=${consult.type}`,
    `fcm_token=${doctorUser.fcm_token ? 'present' : 'MISSING'}`,
    `voip_token=${doctorUser.voip_token ? 'present' : 'MISSING'}`,
    `push_token=${doctorUser.push_token ? 'present' : 'MISSING'}`,
  )
  const isCallStart = kind === 'start' && (consult.type === 'phone' || consult.type === 'video')
  const callStartData = {
    callType:         'incoming_call',
    direction:        'doctor',
    uuid:             appointment_id,
    consultationId:   appointment_id,
    consultationType: consult.type,
    patientName:      patient.full_name ?? 'Patient',
    patientId:        patient.id        ?? '',
    patientClerkId:   patient.clerk_id  ?? '',
    doctorId:         doctorUser.id       ?? '',
    doctorClerkId:    doctorUser.clerk_id ?? '',
    agoraChannel:     appointment_id,
  }
  let doctorFcmDelivered = false
  if (isCallStart && doctorUser.fcm_token && await isPushEnabled(supabase, doctorUser.id, 'appointment_reminder')) {
    doctorFcmDelivered = await sendFCMDataMessage(doctorUser.fcm_token, callStartData, supabase, { userId: doctorUser.id, column: 'fcm_token' })
  }
  if (!doctorFcmDelivered && isCallStart && doctorUser.voip_token && await isPushEnabled(supabase, doctorUser.id, 'appointment_reminder')) {
    doctorFcmDelivered = await sendAPNsVoIPPush(doctorUser.voip_token, callStartData, supabase, { userId: doctorUser.id, column: 'voip_token' })
  }

  if (doctorUser.push_token && await isPushEnabled(supabase, doctorUser.id, 'appointment_reminder')) {
    messages.push(pushMessage(
      doctorUser.push_token, doctorTitle, doctorPushBody,
      { screen: 'consultations', consultationId: appointment_id, notificationId: doctorNotificationId ?? '' },
      undefined,
      await getUnreadBadgeCount(supabase, doctorUser.id),
      `appt-${appointment_id}-${kind}-doctor`,
    ))
    recipients.push({ userId: doctorUser.id })
  }

  const expoResult = await sendExpoPush(messages)
  await logExpoPushErrors(supabase, expoResult, recipients)

  // Web push URLs mirror carehub-web/components/ui/AppointmentAlerts.tsx's
  // resolveUrl() switch so a background push and the in-app toast land on
  // the same screen.
  const patientPushUrl = isReminder ? '/patient/appointments' : `/patient/waiting/${appointment_id}`
  const doctorPushUrl = '/doctor/consultations'
  const webPushSent =
    (await sendWebPush(supabase, patient.id, { title: patientTitle, body: patientBody, url: patientPushUrl })) +
    (await sendWebPush(supabase, doctorUser.id, { title: doctorTitle, body: doctorPushBody, url: doctorPushUrl }))

  // 3. Mark as sent so the cron job skips it next minute
  const sentColumn = kind === 'reminder' ? 'reminder_sent'
    : kind === 'reminder_30' ? 'reminder_30_sent'
    : kind === 'reminder_10' ? 'reminder_10_sent'
    : kind === 'reminder_5' ? 'reminder_5_sent'
    : 'notification_sent'
  await supabase
    .from('consultations')
    .update({ [sentColumn]: true })
    .eq('id', appointment_id)

  return new Response(
    JSON.stringify({ kind, push_sent: messages.length, web_push_sent: webPushSent, in_app_sent: notificationRows.length, expo: expoResult }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
