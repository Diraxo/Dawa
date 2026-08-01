// Supabase Edge Function — notify-document-update-request
//
// Called exclusively by the trg_notify_document_update_request DB trigger
// (via pg_net, migration 108) when a doctor's document_review_status moves
// to 'pending' — i.e. they submitted a document re-upload for review.
// Previously admins had no signal for this beyond noticing the Doctors page
// happened to re-render via its own Realtime subscription; this gives them
// an actual notification (in-app row + web push), mirroring the pattern
// already used for handle-consultation-notification / notify-security-event.
// Admin has no mobile app, so this only ever sends Web Push, never Expo.
//
// POST body: { doctor_profile_id: string }

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

async function sendWebPush(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
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
    console.warn('[notify-document-update-request] web push send failed:', e)
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!bearerToken) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  let payload: { doctor_profile_id?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: corsHeaders })
  }

  const doctorProfileId = payload.doctor_profile_id
  if (!doctorProfileId) {
    return new Response('Missing doctor_profile_id', { status: 400, headers: corsHeaders })
  }

  // Only the DB trigger may call this function — same shared secret already
  // provisioned for handle-consultation-notification / send-appointment-notification.
  if (bearerToken !== Deno.env.get('INTERNAL_NOTIFICATION_SECRET')) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: profile } = await supabase
    .from('doctor_profiles')
    .select('user:users!user_id ( full_name )')
    .eq('id', doctorProfileId)
    .maybeSingle()

  const rawName = (profile as any)?.user?.full_name as string | undefined
  const doctorName = rawName?.replace(/^Dr\.?\s*/i, '') ?? 'A doctor'

  const title = 'Document Update Requested'
  const body = `Dr. ${doctorName} requested document review.`

  const { data: admins } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')

  if (admins && admins.length > 0) {
    await supabase.from('notifications').insert(
      admins.map((a: any) => ({
        user_id: a.id,
        title,
        body,
        type: 'document_update_requested',
        data_json: { doctorProfileId, screen: 'doctors' },
      })),
    )

    await Promise.all(
      admins.map((a: any) => sendWebPush(supabase, a.id, { title, body, url: '/admin/doctors' })),
    )
  }

  return new Response(JSON.stringify({ success: true, notified: admins?.length ?? 0 }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
