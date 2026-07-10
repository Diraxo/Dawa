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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

interface Payload {
  event:           ConsultationEvent
  consultation_id: string
  rating?:         number
}

const TYPE_LABEL: Record<string, string> = {
  chat:  'chat consultation',
  phone: 'phone consultation',
  video: 'video consultation',
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
async function isPushEnabled(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
  category: 'consultation_request' | 'consultation_summary',
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

// ── Expo push (regular) ───────────────────────────────────────────────────────

async function sendPushNotification(
  token:     string,
  title:     string,
  body:      string,
  data:      Record<string, unknown>,
  channel:   string = 'consultations',
  priority:  string = 'normal',
  imageUrl?: string,
) {
  await fetch('https://exp.host/--/api/v2/push/send', {
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
      badge:     1,
      // Rich notification image (Android large icon / iOS attachment) — shows
      // the doctor's profile photo instead of the static app icon when set.
      ...(imageUrl ? { mutableContent: true, richContent: { image: imageUrl } } : {}),
    }),
  })
}

// ── Android FCM data message (triggers ConnectionService) ─────────────────────
// Uses FCM Legacy HTTP API. Secrets required:
//   FCM_SERVER_KEY — Firebase Cloud Messaging server key (from Firebase Console → Project settings → Cloud Messaging)

async function sendFCMDataMessage(
  fcmToken: string,
  data:     Record<string, string>,
): Promise<void> {
  const serverKey = Deno.env.get('FCM_SERVER_KEY')
  if (!serverKey) {
    console.warn('[FCM] FCM_SERVER_KEY not set — Android system call push skipped')
    return
  }

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Authorization': `key=${serverKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      to:                fcmToken,
      data,                         // data-only (no `notification` key) → headless task handles it
      priority:          'high',    // wakes device from Doze mode
      time_to_live:      60,        // 60-second TTL — expires if not delivered quickly
      content_available: true,      // wake iOS device (belt-and-suspenders; VoIP push is preferred)
      android: {
        priority: 'HIGH',
        ttl:      '60s',
      },
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    console.error('[FCM] Data message failed:', res.status, txt)
  } else {
    const json = await res.json()
    if (json.failure > 0) {
      console.error('[FCM] Delivery failure:', JSON.stringify(json.results))
    } else {
      console.log('[FCM] Data message sent successfully')
    }
  }
}

// ── Android: best-effort "stop ringing" signal ─────────────────────────────────
// Sent (in addition to the normal notification for that event) whenever a
// ringing call-type consultation leaves the 'accepted' state without the
// patient having answered from the OS call UI — e.g. missed/timed-out or
// cancelled while still ringing. Without this, a patient whose device is
// still showing the CallKeep/ConnectionService incoming-call screen has no
// way to learn the call is no longer valid until the OS's own ~60s ring
// timeout, which reads as a stray/ghost incoming call in the meantime.
async function sendCallCancelSignal(patientFCM: string | null, consultationId: string): Promise<void> {
  if (!patientFCM) return
  try {
    await sendFCMDataMessage(patientFCM, {
      callType:       'cancel_call',
      uuid:           consultationId,
      consultationId,
    })
  } catch (e) {
    console.warn('[FCM] cancel_call signal failed:', e)
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
): Promise<void> {
  const keyId      = Deno.env.get('APNS_KEY_ID')
  const teamId     = Deno.env.get('APNS_TEAM_ID')
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY')

  if (!keyId || !teamId || !privateKey) {
    console.warn('[APNs] VoIP push credentials not configured — iOS system call push skipped')
    console.warn('[APNs] Set APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY via supabase secrets set')
    return
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
          'apns-expiration': '0',   // discard immediately if device is offline
          'apns-priority':   '10',  // immediate delivery
          'content-type':    'application/json',
        },
        body: JSON.stringify({ aps: {}, ...payload }),
      },
    )

    if (!res.ok) {
      const txt = await res.text()
      console.error('[APNs] VoIP push failed:', res.status, txt)
    } else {
      console.log('[APNs] VoIP push sent successfully')
    }
  } catch (e) {
    console.error('[APNs] VoIP push error:', e)
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
  // function, authenticating with the service-role key via pg_net. This is
  // deliberately not open to client Clerk sessions: every event this function
  // handles already has a corresponding DB trigger, so a client-triggerable
  // path would only ever produce duplicate notifications.
  if (bearerToken !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
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
      consultation_credit,
      credit_amount,
      patient_amount,
      patient:users!patient_id (
        id, clerk_id, full_name, push_token, fcm_token, voip_token
      ),
      doctor_profile:doctor_profiles!doctor_id (
        photo_url,
        specialty,
        user:users ( id, clerk_id, full_name, push_token, fcm_token, voip_token )
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
    doctorName:       doctorUser.full_name ?? '',
    doctorId:         doctorUser.id        ?? '',
    doctorClerkId:    doctorUser.clerk_id  ?? '',
    doctorPhotoUrl:   doctorProfile.photo_url ?? '',
    doctorSpecialty:  doctorProfile.specialty  ?? '',
    agoraChannel:     consultation_id,
  }

  switch (event) {

    // ── Doctor: new consultation request ────────────────────────────────────
    case 'new_request': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'New Consultation Request'
      const body  = `Patient ${patient.full_name ?? 'A patient'} has paid and is waiting for your response.`

      if (doctorId) {
        await supabase.from('notifications').insert({
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
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, title, body, {
          screen: 'incoming_request',
          ...sharedData,
          waitingStartedAt: (consult as any).waiting_started_at ?? '',
        }, 'incoming_requests', 'high')
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

      const title = 'Incoming Consultation'
      const body  = `${formatDoctorName(doctorUser.full_name, 'Your doctor')} is calling. Tap to join.`

      // ── 1. Save in-app notification record ──────────────────────────────────
      if (patientId) {
        await supabase.from('notifications').insert({
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
          doctorName:       doctorUser.full_name ?? 'Doctor',
          doctorSpecialty:  doctorProfile.specialty  ?? '',
          doctorPhotoUrl:   doctorProfile.photo_url  ?? '',
          doctorId:         doctorUser.id       ?? '',
          doctorClerkId:    doctorUser.clerk_id ?? '',
          patientClerkId:   patient.clerk_id    ?? '',
          agoraChannel:     consultation_id,
          screen:           'consultation',
        }

        // Android → FCM data message (high priority, no notification body)
        if (patientFCM) {
          await sendFCMDataMessage(patientFCM, callData)
        }

        // iOS → APNs VoIP push (wakes app via PushKit → CallKit shows native UI)
        if (patientVoIP) {
          await sendAPNsVoIPPush(patientVoIP, callData)
        }
      }

      // ── 3. Expo push fallback (works when app is in background without call tokens) ─
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, {
          screen:          'consultation',
          callType:        isCallType ? 'incoming_call' : '',
          ...sharedData,
        }, 'consultations', 'high', doctorProfile.photo_url || undefined)
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

      if (patientId) {
        await supabase.from('notifications').insert({
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
          ...sharedData,
        }, 'consultations', 'normal', doctorProfile.photo_url || undefined)
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'Consultation Request Closed'
      const doctorBody  = `The ${typeLabel} request from ${patient.full_name ?? 'a patient'} has ended.`

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          type:      'declined',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorBody, {
          screen: 'consultations',
          ...sharedData,
        })
      }
      break
    }

    // ── Patient: cancelled their own consultation ────────────────────────────
    case 'cancelled': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Consultation Cancelled'
      const body  = `Your ${typeLabel} with ${formatDoctorName(doctorUser.full_name, 'your doctor')} has been cancelled.`

      if (isCallType) await sendCallCancelSignal(patient.fcm_token ?? null, consultation_id)

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title,
          body,
          type:      'cancelled',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, title, body, { screen: 'appointments', ...sharedData }, 'consultations', 'normal', doctorProfile.photo_url || undefined)
      }
      break
    }

    // ── Doctor: patient missed / declined ────────────────────────────────────
    case 'missed_call': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Missed Call'
      const body  = `${patient.full_name ?? 'A patient'} missed your ${typeLabel}. The request has been marked as missed.`

      if (isCallType) await sendCallCancelSignal(patient.fcm_token ?? null, consultation_id)

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title,
          body,
          type:      'missed_call',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, title, body, { screen: 'consultations', ...sharedData })
      }
      break
    }

    // ── Doctor: patient explicitly declined the ringing call ────────────────
    case 'call_declined': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'Call Declined'
      const body  = `${patient.full_name ?? 'The patient'} declined your ${typeLabel}.`

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title,
          body,
          type:      'call_declined',
          data_json: { ...sharedData, screen: 'consultations' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, title, body, { screen: 'consultations', ...sharedData })
      }
      break
    }

    // ── Patient: consultation summary ready ──────────────────────────────────
    case 'summary_ready': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const doctorPhoto  = doctorProfile.photo_url || undefined
      const title = formatDoctorName(doctorUser.full_name, 'Your doctor')
      const body  = 'Your consultation summary is ready. Tap to view.'

      if (patientId) {
        await supabase.from('notifications').insert({
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
          ...sharedData,
        }, 'consultations', 'normal', doctorPhoto)
      }
      break
    }

    // ── Patient: consultation summary edited by doctor ───────────────────────
    case 'summary_updated': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const doctorPhoto  = doctorProfile.photo_url || undefined
      const title = formatDoctorName(doctorUser.full_name, 'Your doctor')
      const body  = 'Your consultation summary is ready. Tap to view.'

      if (patientId) {
        await supabase.from('notifications').insert({
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
          ...sharedData,
        }, 'consultations', 'normal', doctorPhoto)
      }
      break
    }

    // ── Doctor: new star rating received ────────────────────────────────────
    case 'review_received': {
      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const title = 'New Rating Received'
      const body  = `${patient.full_name ?? 'A patient'} rated your consultation ${STARS[Math.min(rating ?? 5, 5)]}`

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title,
          body,
          type:      'review_received',
          data_json: { ...sharedData, screen: 'profile' },
        })
      }
      if (doctorToken) {
        await sendPushNotification(doctorToken, title, body, { screen: 'profile', ...sharedData })
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

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title:     patientTitle,
          body:      patientBody,
          type:      'scheduled_booking',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen: 'appointments', ...sharedData,
        }, 'consultations', 'normal', doctorProfile.photo_url || undefined)
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'New Scheduled Appointment'
      const doctorBody  = `${patient.full_name ?? 'A patient'} booked a ${typeLabel} for ${date} at ${time}.`

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          type:      'scheduled_booking',
          // 'schedule' (not 'consultations') — the Consultations list's
          // "incoming" bucket only surfaces waiting_for_doctor/pending rows,
          // so a freshly booked 'scheduled' appointment opened there was
          // unclickable dead weight. Schedule is the doctor's actual
          // upcoming-appointments view (see Issue 5/6 fix).
          data_json: { ...sharedData, screen: 'schedule' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorBody, {
          screen: 'schedule', ...sharedData,
        })
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

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title:     patientTitle,
          body:      patientBody,
          type:      'rescheduled',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken && await isPushEnabled(supabase, patientId, 'consultation_request')) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen: 'appointments', ...sharedData,
        }, 'consultations', 'normal', doctorProfile.photo_url || undefined)
      }

      const doctorId    = doctorUser.id         ?? null
      const doctorToken = doctorUser.push_token ?? null
      const doctorTitle = 'Appointment Rescheduled'
      const doctorBody  = `${patient.full_name ?? 'A patient'} rescheduled their ${typeLabel} to ${date} at ${time}.`

      if (doctorId) {
        await supabase.from('notifications').insert({
          user_id:   doctorId,
          title:     doctorTitle,
          body:      doctorBody,
          type:      'rescheduled',
          data_json: { ...sharedData, screen: 'schedule' },
        })
      }
      if (doctorToken && await isPushEnabled(supabase, doctorId, 'consultation_request')) {
        await sendPushNotification(doctorToken, doctorTitle, doctorBody, {
          screen: 'schedule', ...sharedData,
        })
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
