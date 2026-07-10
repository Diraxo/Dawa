// Supabase Edge Function — send-appointment-notification
// Triggered by pg_cron:
//   - kind "reminder_30" / "reminder_5" → 30 / 5 minutes before scheduled_at
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

interface Payload {
  appointment_id?: string
  reminder_id?: string
  kind?: 'reminder' | 'reminder_30' | 'reminder_5' | 'start' | 'followup'
}

const TYPE_LABEL: Record<string, string> = {
  chat: 'Chat',
  phone: 'Phone Call',
  video: 'Video Call',
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
) {
  return {
    to: pushToken,
    channelId: 'appointments',
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    badge: 1,
    // Rich notification image (Android large icon / iOS attachment) — shows
    // the doctor's profile photo instead of the static app icon when set.
    ...(imageUrl ? { mutableContent: true, richContent: { image: imageUrl } } : {}),
  }
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
  return res.json()
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // This function is only ever legitimately invoked by pg_cron (via pg_net,
  // authenticating with the vault service-role key) — there is no direct
  // client caller. Reject anything else; otherwise anyone who reaches this
  // URL could spam real push notifications, or mark a row as sent to
  // suppress the real reminder.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (bearerToken !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
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
        doctor:doctor_profiles!doctor_id ( photo_url, user:users ( id, full_name, push_token ) )
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
    const doctorPhoto = (reminder.doctor as any)?.photo_url || undefined
    const title = 'Follow-up Reminder'
    const body = reminder.message?.trim()
      ? reminder.message
      : `${formatDoctorName(doctorUser.full_name, 'Your doctor')} scheduled a follow-up reminder for you.`
    // 'consultation_summary' (underscore) matches the existing deep-link
    // switch in app/_layout.tsx — opens app/(patient)/consultation-summary.tsx.
    const data = { screen: 'consultation_summary', consultationId: reminder.consultation_id, reminderId: reminder.id }

    if (patient.id) {
      await supabase.from('notifications').insert({
        user_id: patient.id, type: 'followup_reminder', title, body,
        data_json: { consultation_id: reminder.consultation_id, reminder_id: reminder.id },
      })
    }

    const messages: object[] = []
    if (patient.push_token && await isPushEnabled(supabase, patient.id, 'appointment_reminder')) {
      messages.push(pushMessage(patient.push_token, title, body, data, doctorPhoto))
    }
    const expoResult = await sendExpoPush(messages)

    await supabase.from('followup_reminders').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', reminder_id)

    return new Response(
      JSON.stringify({ kind, push_sent: messages.length, expo: expoResult }),
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
      reminder_5_sent,
      patient:users!patient_id ( id, full_name, push_token ),
      doctor_profile:doctor_profiles!doctor_id (
        photo_url,
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
  const alreadySentByKind: Record<string, boolean> = {
    reminder: !!consult.reminder_sent,
    reminder_30: !!consult.reminder_30_sent,
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
  const doctorPhoto = (consult.doctor_profile as any)?.photo_url || undefined
  const typeLabel = TYPE_LABEL[consult.type] ?? 'Consultation'

  const isReminder = kind === 'reminder' || kind === 'reminder_30' || kind === 'reminder_5'
  const minutesOut = kind === 'reminder_30' ? 30 : kind === 'reminder_5' ? 5 : 15

  const title = isReminder ? 'Appointment Starting Soon' : 'Consultation Ready'
  const patientBody = isReminder
    ? `Your ${typeLabel} with ${formatDoctorName(doctorUser.full_name, 'your doctor')} starts in ${minutesOut} minutes.`
    : 'Your consultation is ready.'
  const doctorBody = isReminder
    ? `Your ${typeLabel} with ${patient.full_name ?? 'your patient'} starts in ${minutesOut} minutes.`
    : 'Your scheduled consultation is ready.'

  // 1. Insert in-app notification rows (read by mobile + website)
  const notificationRows = []
  if (patient.id) {
    notificationRows.push({
      user_id: patient.id,
      title,
      body: patientBody,
      type: isReminder ? 'appointment_reminder' : 'appointment_start',
      data_json: !isReminder
        ? {
            screen: 'consultation',
            consultationId: appointment_id,
            consultationType: consult.type,
            doctorName: doctorUser.full_name ?? '',
            doctorId:   doctorUser.id        ?? '',
          }
        : { screen: 'appointments', consultationId: appointment_id, consultationType: consult.type },
    })
  }
  if (doctorUser.id) {
    notificationRows.push({
      user_id: doctorUser.id,
      title,
      body: doctorBody,
      type: isReminder ? 'appointment_reminder' : 'appointment_start',
      data_json: { screen: 'consultations', consultationId: appointment_id, consultationType: consult.type },
    })
  }
  if (notificationRows.length > 0) {
    await supabase.from('notifications').insert(notificationRows)
  }

  // 2. Send push notifications via Expo Push API
  const messages: object[] = []
  if (patient.push_token && await isPushEnabled(supabase, patient.id, 'appointment_reminder')) {
    messages.push(pushMessage(
      patient.push_token, title, patientBody,
      // For 'start' notifications navigate directly to the consultation screen;
      // for reminders open the appointments list so the patient can review the booking.
      !isReminder
        ? {
            screen: 'consultation',
            consultationId: appointment_id,
            consultationType: consult.type,
            doctorName: doctorUser.full_name ?? '',
            doctorId:   doctorUser.id        ?? '',
          }
        : { screen: 'appointments', consultationId: appointment_id },
      doctorPhoto,
    ))
  }
  if (doctorUser.push_token && await isPushEnabled(supabase, doctorUser.id, 'appointment_reminder')) {
    messages.push(pushMessage(
      doctorUser.push_token, title, doctorBody,
      { screen: 'consultations', consultationId: appointment_id }
    ))
  }

  const expoResult = await sendExpoPush(messages)

  // 3. Mark as sent so the cron job skips it next minute
  const sentColumn = kind === 'reminder' ? 'reminder_sent'
    : kind === 'reminder_30' ? 'reminder_30_sent'
    : kind === 'reminder_5' ? 'reminder_5_sent'
    : 'notification_sent'
  await supabase
    .from('consultations')
    .update({ [sentColumn]: true })
    .eq('id', appointment_id)

  return new Response(
    JSON.stringify({ kind, push_sent: messages.length, in_app_sent: notificationRows.length, expo: expoResult }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
