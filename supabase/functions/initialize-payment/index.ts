// Supabase Edge Function — initialize-payment
// Called by the mobile app and website to start a Chapa checkout session.
// Returns a checkout_url the client opens, and saves the tx_ref to the
// consultation record immediately so the webhook trigger can fire.
// Also accepts an optional credit_source_id for partial-credit bookings
// where only the difference amount is charged via Chapa.
//
// Security: verifies the caller's Clerk session, confirms they own
// consultation_id (and credit_source_id, if supplied), and derives the
// amount charged from the DB rather than trusting the client — mirrors the
// pattern already used by apply-credit/index.ts and agora-token/index.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose'

const ALLOWED_ORIGINS = new Set([
  'https://dawa.com',
  'http://localhost:3000',
  'http://localhost:19006',
])

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dawa.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

interface Payload {
  consultation_id:  string
  email:            string
  first_name:       string
  last_name:        string
  type:             string        // 'chat' | 'phone' | 'video'
  doctor_name:      string
  return_url:       string        // deep-link for mobile, https page for web
  credit_source_id?: string       // for partial-credit bookings: the declined consultation ID
}

interface ChapaInitResponse {
  message: string
  status: string
  data?: { checkout_url: string }
}

const TYPE_LABEL: Record<string, string> = {
  chat:  'Chat Consultation',
  phone: 'Phone Consultation',
  video: 'Video Consultation',
}

// `doctor_name` is passed through as-is by whichever client screen calls this
// function, and doctor registration invites free-text names that may already
// contain "Dr." — strip any existing prefix before prepending our own so the
// Chapa checkout page never shows "Dr. Dr. Name".
function formatDoctorName(rawName: string | null | undefined): string {
  const name = (rawName ?? '').trim()
  if (!name) return 'your doctor'
  return `Dr. ${name.replace(/^Dr\.?\s+/i, '').trim()}`
}

// Chapa test secret keys are prefixed CHASECK_TEST-, live keys CHASECK-.
// Never log the full key — only enough to confirm which one is loaded.
function maskChapaKey(key: string): { masked: string; mode: 'test' | 'live' | 'unknown' } {
  const mode = /test/i.test(key) ? 'test' : /^CHASECK-/i.test(key) ? 'live' : 'unknown'
  const visible = key.slice(0, 12)
  return { masked: `${visible}${'*'.repeat(Math.max(key.length - visible.length, 0))}`, mode }
}

Deno.serve(async (req: Request) => {
  const CORS = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  // Verify the caller's own Clerk session — this endpoint writes a Chapa
  // tx_ref (and optionally a credit_source_id) onto a consultation row using
  // the service-role client, so the target consultation_id must be proven to
  // belong to the caller, not trusted as a body field.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
  const clerkToken = authHeader.slice(7)
  const clerkFrontendApi = Deno.env.get('CLERK_FRONTEND_API')!
  const jwks = createRemoteJWKSet(new URL(`${clerkFrontendApi}/.well-known/jwks.json`))
  let clerkSub: string
  try {
    const { payload } = await jwtVerify(clerkToken, jwks)
    clerkSub = payload.sub!
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS })
  }

  const { consultation_id, email, first_name, last_name, type, doctor_name, return_url, credit_source_id } = payload
  if (!consultation_id || !email || !return_url) {
    return new Response('Missing required fields', { status: 400, headers: CORS })
  }

  const chapaKey = Deno.env.get('CHAPA_SECRET_KEY')
  if (!chapaKey) {
    console.error('[initialize-payment] CHAPA_SECRET_KEY is not set in this environment')
    return new Response('Payment service not configured', { status: 500, headers: CORS })
  }
  const { masked, mode } = maskChapaKey(chapaKey)
  console.log(`[initialize-payment] Chapa key mode=${mode} loaded=${masked}`)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Rate limit: 10 payment-init attempts / 10 minutes / caller ────────────
  // Reuses the same rate_limits table the rate-limit edge function already
  // uses for login/OTP. Fails open on any unexpected error so a limiter bug
  // can never block a real payment.
  try {
    const rlId = `payment:${clerkSub}`
    const { data: rl } = await supabase
      .from('rate_limits')
      .select('count, first_attempt_at, locked_until')
      .eq('identifier', rlId)
      .eq('attempt_type', 'payment_init')
      .maybeSingle()

    const now = Date.now()
    if (rl?.locked_until && new Date(rl.locked_until).getTime() > now) {
      return new Response(
        JSON.stringify({ error: 'Too many payment attempts. Please try again shortly.' }),
        { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const windowExpired = !rl || new Date(rl.first_attempt_at).getTime() < now - 10 * 60_000
    if (windowExpired) {
      await supabase.from('rate_limits').upsert(
        { identifier: rlId, attempt_type: 'payment_init', count: 1, first_attempt_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), locked_until: null },
        { onConflict: 'identifier,attempt_type' },
      )
    } else {
      const newCount = rl.count + 1
      await supabase.from('rate_limits').update({
        count: newCount,
        last_attempt_at: new Date().toISOString(),
        locked_until: newCount >= 10 ? new Date(now + 30 * 60_000).toISOString() : rl.locked_until,
      }).eq('identifier', rlId).eq('attempt_type', 'payment_init')
    }
  } catch (err) {
    console.error('[initialize-payment] rate limit check failed (failing open):', err)
  }

  // ── Verify ownership of consultation_id and derive the real amount ────────
  const { data: consult, error: consultErr } = await supabase
    .from('consultations')
    .select('id, patient_amount, payment_status, type, patient:users!patient_id(clerk_id)')
    .eq('id', consultation_id)
    .single()

  if (consultErr || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const consultPatientClerkId = (consult.patient as any)?.clerk_id
  if (consultPatientClerkId !== clerkSub) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  if ((consult as any).payment_status === 'paid') {
    return new Response(
      JSON.stringify({ error: 'This consultation has already been paid for' }),
      { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  let amount = Number((consult as any).patient_amount ?? 0)

  if (credit_source_id) {
    const { data: creditConsult, error: creditErr } = await supabase
      .from('consultations')
      .select('id, type, credit_amount, credit_used, patient:users!patient_id(clerk_id)')
      .eq('id', credit_source_id)
      .single()

    if (creditErr || !creditConsult) {
      return new Response(
        JSON.stringify({ error: 'Credit consultation not found' }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const creditPatientClerkId = (creditConsult.patient as any)?.clerk_id
    if (creditPatientClerkId !== clerkSub) {
      return new Response(
        JSON.stringify({ error: 'Credit does not belong to this patient' }),
        { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }
    if ((creditConsult as any).credit_used) {
      return new Response(
        JSON.stringify({ error: 'Credit has already been used' }),
        { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }
    if ((creditConsult as any).type !== (consult as any).type) {
      return new Response(
        JSON.stringify({ error: 'Credit can only be applied to the same consultation type it was paid for' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const creditAmount = Number((creditConsult as any).credit_amount ?? 0)
    amount = Math.max(amount - creditAmount, 0)
  }

  if (amount <= 0) {
    return new Response(
      JSON.stringify({ error: 'No payment is required for this consultation' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // tx_ref must be ≤ 50 chars (Chapa limit).
  // Strip UUID hyphens (36→32 chars), take first 20, append base-36 timestamp (~9 chars).
  // Format: dw-{20 hex chars}-{base36 ts} = 3+20+1+9 = 33 chars max.
  const shortId = consultation_id.replace(/-/g, '').slice(0, 20)
  const tx_ref  = `dw-${shortId}-${Date.now().toString(36)}`

  const chapaPayload = {
    amount:   amount.toString(),
    currency: 'ETB',
    email,
    first_name: first_name || 'Patient',
    last_name:  last_name  || first_name || 'User',
    tx_ref,
    callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/chapa-webhook`,
    return_url,
    customization: {
      title:       'Dawa Health',
      description: `${TYPE_LABEL[type] ?? 'Consultation'} with ${formatDoctorName(doctor_name)}`,
      logo:        'https://ulrgkqjjiclulnuotifh.supabase.co/storage/v1/object/public/assets/icon.png',
    },
  }

  // Log the exact outgoing request (Authorization redacted, everything else as-sent).
  console.log('[initialize-payment] Chapa request URL: https://api.chapa.co/v1/transaction/initialize')
  console.log('[initialize-payment] Chapa request body:', JSON.stringify(chapaPayload))
  console.log(`[initialize-payment] Authorization header: Bearer ${masked}`)

  let chapaData: ChapaInitResponse
  try {
    const resp = await fetch('https://api.chapa.co/v1/transaction/initialize', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${chapaKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(chapaPayload),
    })
    chapaData = await resp.json() as ChapaInitResponse

    // Always log the complete response — status, headers, and body — not just "failed".
    console.log('[initialize-payment] Chapa HTTP status:', resp.status)
    console.log('[initialize-payment] Chapa response headers:', JSON.stringify(Object.fromEntries(resp.headers.entries())))
    console.log('[initialize-payment] Chapa response body:', JSON.stringify(chapaData))

    if (!resp.ok || chapaData.status !== 'success' || !chapaData.data?.checkout_url) {
      // Chapa sometimes returns message as a validation-error object, not a string.
      // Always convert to a readable string for the browser error banner.
      const raw = (chapaData as any)?.message
      const chapaMessage = typeof raw === 'string'
        ? raw
        : (raw != null ? JSON.stringify(raw) : JSON.stringify(chapaData))
      return new Response(
        JSON.stringify({ error: chapaMessage, detail: chapaData }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }
  } catch (err) {
    console.error('[initialize-payment] Network error:', err)
    return new Response('Payment service unreachable', { status: 503, headers: CORS })
  }

  // Save tx_ref (and optionally credit_source_id) to consultation so the webhook can fire correctly.
  const txUpdate: Record<string, unknown> = { chapa_tx_ref: tx_ref }
  if (credit_source_id) txUpdate.credit_source_id = credit_source_id

  await supabase
    .from('consultations')
    .update(txUpdate)
    .eq('id', consultation_id)

  return new Response(
    JSON.stringify({ checkout_url: chapaData.data!.checkout_url, tx_ref }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
