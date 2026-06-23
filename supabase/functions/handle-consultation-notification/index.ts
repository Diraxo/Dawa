// Supabase Edge Function — handle-consultation-notification
// Called by database triggers (via pg_net) when consultation events occur.
//
// Events:
//   new_request    → notify DOCTOR  (patient entered waiting room, payment confirmed)
//   accepted       → notify PATIENT (doctor accepted, tap to join)
//   declined       → notify PATIENT + DOCTOR (doctor declined — credit issued to patient)
//   summary_ready  → notify PATIENT (doctor submitted consultation notes)
//   review_received→ notify DOCTOR  (patient left a star rating)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type ConsultationEvent =
  | 'new_request'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'summary_ready'
  | 'review_received'

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

async function sendPushNotification(
  token:    string,
  title:    string,
  body:     string,
  data:     Record<string, unknown>,
  channel:  string = 'consultations',
  priority: string = 'normal',
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
    }),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
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

  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      waiting_started_at,
      consultation_credit,
      credit_amount,
      patient_amount,
      patient:users!patient_id ( id, clerk_id, full_name, push_token ),
      doctor_profile:doctor_profiles!doctor_id (
        user:users ( id, clerk_id, full_name, push_token )
      )
    `)
    .eq('id', consultation_id)
    .single()

  if (error || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found', detail: error?.message }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const patient    = (consult.patient as any)    ?? {}
  const doctorUser = (consult.doctor_profile as any)?.user ?? {}
  const typeLabel  = TYPE_LABEL[consult.type as string] ?? 'consultation'

  // ── Shared push data fields ────────────────────────────────────────────
  const sharedData = {
    consultationId:   consultation_id,
    consultationType: consult.type,
    patientName:      patient.full_name    ?? '',
    patientId:        patient.id           ?? '',
    patientClerkId:   patient.clerk_id     ?? '',
    doctorName:       doctorUser.full_name ?? '',
    doctorId:         doctorUser.id        ?? '',
    doctorClerkId:    doctorUser.clerk_id  ?? '',
  }

  switch (event) {

    // ── Doctor: new consultation request (patient paid and is waiting) ──────
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
      if (doctorToken) {
        await sendPushNotification(doctorToken, title, body, {
          screen: 'incoming_request',
          ...sharedData,
          waitingStartedAt: (consult as any).waiting_started_at ?? '',
        }, 'incoming_requests', 'high')
      }
      // Mark notification_sent so the cron skips this consultation and we have
      // confirmation that the doctor was notified.
      await supabase
        .from('consultations')
        .update({ notification_sent: true })
        .eq('id', consultation_id)
      break
    }

    // ── Patient: doctor accepted ─────────────────────────────────────────────
    case 'accepted': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Consultation Accepted'
      const body  = `Dr. ${doctorUser.full_name ?? 'Your doctor'} accepted your consultation. Tap to join.`

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title,
          body,
          type:      'accepted',
          data_json: { ...sharedData, screen: 'consultation' },
        })
      }
      if (patientToken) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'consultation',
          ...sharedData,
        }, 'consultations', 'high')
      }
      break
    }

    // ── Patient: doctor declined — credit issued ─────────────────────────────
    case 'declined': {
      const creditAmount = Number((consult as any).credit_amount ?? (consult as any).patient_amount ?? 0)

      // Notify patient
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const patientTitle = 'Consultation Unavailable'
      const patientBody  = `Dr. ${doctorUser.full_name ?? 'The doctor'} is unavailable. Your consultation credit has been preserved. Please choose another doctor.`

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
      if (patientToken) {
        await sendPushNotification(patientToken, patientTitle, patientBody, {
          screen:               'appointments',
          consultationCredit:   true,
          creditAmount:         creditAmount.toString(),
          creditConsultationId: consultation_id,
          ...sharedData,
        })
      }

      // Notify doctor (session ended)
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
      if (doctorToken) {
        await sendPushNotification(doctorToken, doctorTitle, doctorBody, {
          screen: 'consultations',
          ...sharedData,
        })
      }
      break
    }

    // ── Patient: they cancelled their own consultation — no credit ───────────
    case 'cancelled': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Consultation Cancelled'
      const body  = `Your ${typeLabel} with Dr. ${doctorUser.full_name ?? 'your doctor'} has been cancelled.`

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title,
          body,
          type:      'cancelled',
          data_json: { ...sharedData, screen: 'appointments' },
        })
      }
      if (patientToken) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'appointments',
          ...sharedData,
        })
      }
      break
    }

    // ── Patient: consultation summary (notes + prescription) is ready ────────
    case 'summary_ready': {
      const patientId    = patient.id         ?? null
      const patientToken = patient.push_token ?? null
      const title = 'Consultation Completed'
      const body  = `Dr. ${doctorUser.full_name ?? 'Your doctor'} has added your consultation summary. Tap to view.`

      if (patientId) {
        await supabase.from('notifications').insert({
          user_id:   patientId,
          title,
          body,
          type:      'summary_ready',
          data_json: { ...sharedData, screen: 'consultation_summary' },
        })
      }
      if (patientToken) {
        await sendPushNotification(patientToken, title, body, {
          screen: 'consultation_summary',
          ...sharedData,
        })
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
        await sendPushNotification(doctorToken, title, body, {
          screen: 'profile',
          ...sharedData,
        })
      }
      break
    }

    default:
      return new Response('Unknown event type', { status: 400 })
  }

  return new Response(
    JSON.stringify({ event, sent: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
