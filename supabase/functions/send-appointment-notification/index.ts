// Supabase Edge Function — send-appointment-notification
// Triggered by pg_cron every minute for appointments starting within ±30 seconds.
// Sends an Expo push notification (delivered via FCM on Android, APNs on iOS)
// to both the patient and the doctor.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Payload {
  appointment_id: string
}

const TYPE_LABEL: Record<string, string> = {
  chat: 'Chat',
  phone: 'Phone Call',
  video: 'Video Call',
}

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { appointment_id } = payload
  if (!appointment_id) {
    return new Response('Missing appointment_id', { status: 400 })
  }

  // Service-role client — can read all rows regardless of RLS
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch consultation details including push tokens for both parties
  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      scheduled_at,
      notification_sent,
      patient:users!patient_id ( full_name, push_token ),
      doctor_profile:doctor_profiles!doctor_id (
        user:users ( full_name, push_token )
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

  // Guard: do not send twice
  if (consult.notification_sent) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'already_sent' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const patientToken: string | null = (consult.patient as any)?.push_token ?? null
  const doctorToken: string | null = (consult.doctor_profile as any)?.user?.push_token ?? null
  const doctorName: string = (consult.doctor_profile as any)?.user?.full_name ?? 'your doctor'
  const patientName: string = (consult.patient as any)?.full_name ?? 'your patient'
  const typeLabel = TYPE_LABEL[consult.type] ?? 'Consultation'

  // Build the list of messages to send
  const messages: object[] = []

  if (patientToken) {
    messages.push({
      to: patientToken,
      channelId: 'appointments',
      title: 'Consultation Starting Now',
      body: `Your ${typeLabel} with ${doctorName} is starting. Open the app to join.`,
      data: { screen: 'appointments', consultationId: appointment_id },
      sound: 'default',
      priority: 'high',
      badge: 1,
    })
  }

  if (doctorToken) {
    messages.push({
      to: doctorToken,
      channelId: 'appointments',
      title: 'Consultation Starting Now',
      body: `Your ${typeLabel} with ${patientName} is starting. Open the app to begin.`,
      data: { screen: 'appointments', consultationId: appointment_id },
      sound: 'default',
      priority: 'high',
      badge: 1,
    })
  }

  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, reason: 'no_push_tokens' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Send via Expo Push API
  // Expo routes each message to FCM (Android) or APNs (iOS) based on the token prefix
  const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  })

  const expoResult = await expoResponse.json()

  // Mark this appointment as notified so the cron job skips it next minute
  await supabase
    .from('consultations')
    .update({ notification_sent: true })
    .eq('id', appointment_id)

  return new Response(
    JSON.stringify({ sent: messages.length, expo: expoResult }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
