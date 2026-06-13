// Supabase Edge Function — send-appointment-notification
// Triggered by pg_cron:
//   - kind "reminder" → ~15 minutes before scheduled_at
//   - kind "start"    → at scheduled_at (±30 seconds)
// Sends an Expo push notification (FCM on Android, APNs on iOS) to both the
// patient and the doctor, and inserts a row into the notifications table for
// each so the website can display the same alert.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Payload {
  appointment_id: string
  kind?: 'reminder' | 'start'
}

const TYPE_LABEL: Record<string, string> = {
  chat: 'Chat',
  phone: 'Phone Call',
  video: 'Video Call',
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

  const { appointment_id, kind = 'start' } = payload
  if (!appointment_id) {
    return new Response('Missing appointment_id', { status: 400 })
  }

  // Service-role client — can read all rows regardless of RLS
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // consultations.doctor_id → doctor_profiles.id → users
  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      scheduled_at,
      notification_sent,
      reminder_sent,
      patient:users!patient_id ( id, full_name, push_token ),
      doctor_profile:doctor_profiles!doctor_id (
        user:users ( id, full_name, push_token )
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
  const alreadySent = kind === 'reminder' ? consult.reminder_sent : consult.notification_sent
  if (alreadySent) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'already_sent' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const patient = (consult.patient as any) ?? {}
  const doctorUser = (consult.doctor_profile as any)?.user ?? {}
  const typeLabel = TYPE_LABEL[consult.type] ?? 'Consultation'

  const title = kind === 'reminder' ? 'Appointment Starting Soon' : 'Consultation Starting Now'
  const patientBody = kind === 'reminder'
    ? `Your ${typeLabel} with ${doctorUser.full_name ?? 'your doctor'} starts in 15 minutes.`
    : `Your ${typeLabel} with ${doctorUser.full_name ?? 'your doctor'} is starting. Open the app to join.`
  const doctorBody = kind === 'reminder'
    ? `Your ${typeLabel} with ${patient.full_name ?? 'your patient'} starts in 15 minutes.`
    : `Your ${typeLabel} with ${patient.full_name ?? 'your patient'} is starting. Open the app to begin.`

  // 1. Insert in-app notification rows (read by mobile + website)
  const notificationRows = []
  if (patient.id) {
    notificationRows.push({
      user_id: patient.id,
      title,
      body: patientBody,
      type: kind === 'reminder' ? 'appointment_reminder' : 'appointment_start',
      data_json: { consultationId: appointment_id, consultationType: consult.type },
    })
  }
  if (doctorUser.id) {
    notificationRows.push({
      user_id: doctorUser.id,
      title,
      body: doctorBody,
      type: kind === 'reminder' ? 'appointment_reminder' : 'appointment_start',
      data_json: { consultationId: appointment_id, consultationType: consult.type },
    })
  }
  if (notificationRows.length > 0) {
    await supabase.from('notifications').insert(notificationRows)
  }

  // 2. Send push notifications via Expo Push API
  const messages: object[] = []
  if (patient.push_token) {
    messages.push({
      to: patient.push_token,
      channelId: 'appointments',
      title,
      body: patientBody,
      data: { screen: 'appointments', consultationId: appointment_id },
      sound: 'default',
      priority: 'high',
      badge: 1,
    })
  }
  if (doctorUser.push_token) {
    messages.push({
      to: doctorUser.push_token,
      channelId: 'appointments',
      title,
      body: doctorBody,
      data: { screen: 'appointments', consultationId: appointment_id },
      sound: 'default',
      priority: 'high',
      badge: 1,
    })
  }

  let expoResult: unknown = null
  if (messages.length > 0) {
    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    })
    expoResult = await expoResponse.json()
  }

  // 3. Mark as sent so the cron job skips it next minute
  await supabase
    .from('consultations')
    .update(kind === 'reminder' ? { reminder_sent: true } : { notification_sent: true })
    .eq('id', appointment_id)

  return new Response(
    JSON.stringify({ kind, push_sent: messages.length, in_app_sent: notificationRows.length, expo: expoResult }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
