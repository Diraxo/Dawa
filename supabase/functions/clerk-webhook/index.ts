// Supabase Edge Function — clerk-webhook
//
// Clerk calls this on account lifecycle events. The `users` row is only
// otherwise cleaned up client-side, right before `user.delete()`, in the
// app's own "permanently delete account" flow (patient/doctor profile
// screens, mobile + web). If that step never runs — the request was killed
// mid-flow, or someone deletes the Clerk user directly from the Clerk
// Dashboard — the row is orphaned with the real email still on it, and
// users_email_key then permanently blocks that email from ever completing
// role selection again (see app/(auth)/role.tsx). This webhook is the
// server-side backstop: on `user.deleted`, anonymize the row the same way
// the client flow does, regardless of how the Clerk user was removed.
//
// Setup (one-time, in Clerk Dashboard → Webhooks):
//   1. Add endpoint: https://<project-ref>.supabase.co/functions/v1/clerk-webhook
//   2. Subscribe to: user.deleted
//   3. Copy the "Signing Secret" (starts with whsec_) into this project's
//      Supabase secrets as CLERK_WEBHOOK_SIGNING_SECRET
//   4. Deploy with --no-verify-jwt (Clerk signs with Svix, not a Supabase JWT)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function base64Decode(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

// Clerk signs webhooks using the Svix scheme: HMAC-SHA256 over
// "{id}.{timestamp}.{body}", keyed by the base64 portion of the whsec_
// secret. Verified manually here (no svix npm dependency) so this function
// stays a single self-contained Deno file like the project's other webhooks.
async function verifySvixSignature(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('CLERK_WEBHOOK_SIGNING_SECRET')
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set in this environment')
    return false
  }

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Reject stale/replayed deliveries outside a 5-minute tolerance window.
  const timestampSeconds = Number(svixTimestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    console.warn('[clerk-webhook] Timestamp outside tolerance — rejecting')
    return false
  }

  const secretBytes = base64Decode(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signedContent = `${svixId}.${svixTimestamp}.${body}`
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = base64Encode(new Uint8Array(signatureBytes))

  // svix-signature carries one or more space-separated "v1,<base64>" values
  // (multiple during secret rotation) — a match on any of them is valid.
  return svixSignature.split(' ').some((part) => part.split(',')[1] === expected)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()

  if (!(await verifySvixSignature(req, body))) {
    console.warn('[clerk-webhook] Signature verification failed')
    return new Response('Invalid signature', { status: 401 })
  }

  let event: { type: string; data?: { id?: string } }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Ack everything else so Clerk doesn't retry-storm this endpoint for
  // events this function doesn't act on yet.
  if (event.type !== 'user.deleted') {
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const clerkId = event.data?.id
  if (!clerkId) return new Response('Missing user id', { status: 400 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: existing } = await supabase
    .from('users')
    .select('role')
    .eq('clerk_id', clerkId)
    .maybeSingle()

  if (!existing) {
    // Already cleaned up by the app's own delete flow, or the Clerk user was
    // removed before ever completing role selection — nothing to do.
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const label =
    existing.role === 'doctor' ? 'Deleted Doctor' :
    existing.role === 'patient' ? 'Deleted Patient' : 'Deleted User'

  // Anonymize — never hard-delete: consultations/messages/reviews reference
  // this row with ON DELETE NO ACTION, so removing it outright would throw a
  // foreign-key violation for anyone who ever had a consultation. Same
  // contract as the client-side delete-account flow in profile.tsx.
  const { error } = await supabase
    .from('users')
    .update({
      full_name: label,
      email: `deleted-${clerkId}@dawa.invalid`,
      phone: null,
      profile_photo_url: null,
      push_token: null,
      fcm_token: null,
      voip_token: null,
      is_suspended: true,
    })
    .eq('clerk_id', clerkId)

  if (error) {
    console.error('[clerk-webhook] Failed to anonymize users row:', error)
    return new Response('DB update failed', { status: 500 })
  }

  console.log('[clerk-webhook] Anonymized users row for deleted Clerk user', clerkId)
  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
