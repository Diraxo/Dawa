// Supabase Edge Function — dev-payment-bypass
//
// Root cause of Release Blocker Issue 7 ("Development payment verification
// is stuck"): BookingModal.tsx's dev-only simulated-payment path used to
// write payment_status: 'paid' directly from the patient's own authenticated
// client. Migration 089's guard_consultation_financial_columns trigger now
// rejects any non-service-role write to that column (a deliberate fix for a
// real tampering gap — see that migration), so the write silently failed
// (no error was ever checked) and the consultation row stayed at
// payment_status: 'pending' forever, leaving the patient stuck on the
// "Verifying Payment" / "Payment Successful" screen with nothing to poll
// for.
//
// This function is the dev-only replacement: it performs the identical
// payment_status: 'paid' write chapa-webhook performs after a real Chapa
// verification, but via the service-role client (so it legitimately bypasses
// migration 089's guard instead of being blocked by it), and only after
// confirming the caller owns the consultation. It is a strict no-op unless
// DEV_PAYMENT_BYPASS_ENABLED=true is set as a secret on this Supabase
// project — a project-level switch independent of the client's own __DEV__
// check, so this endpoint cannot do anything even if a client build were
// somehow shipped with the bypass flag left on.
//
// Never touches chapa_tx_ref (arms the real Chapa refund trigger) or any
// Chapa endpoint — no real money is ever involved on this path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose'

interface Payload {
  consultation_id: string
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  if (Deno.env.get('DEV_PAYMENT_BYPASS_ENABLED') !== 'true') {
    return new Response(
      JSON.stringify({ error: 'Dev payment bypass is not enabled in this environment' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
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
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { consultation_id } = payload
  if (!consultation_id) {
    return new Response('Missing consultation_id', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: consult, error: consultErr } = await supabase
    .from('consultations')
    .select('id, status, payment_status, patient:users!patient_id(clerk_id)')
    .eq('id', consultation_id)
    .single()

  if (consultErr || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const patientClerkId = (consult.patient as any)?.clerk_id
  if (patientClerkId !== clerkSub) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if ((consult as any).status !== 'pending_payment') {
    return new Response(
      JSON.stringify({ error: 'This consultation is not awaiting payment' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if ((consult as any).payment_status === 'paid') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error: updateErr } = await supabase
    .from('consultations')
    .update({ payment_status: 'paid' })
    .eq('id', consultation_id)
    .eq('status', 'pending_payment')
    .neq('payment_status', 'paid')

  if (updateErr) {
    console.error('[dev-payment-bypass] DB update error:', updateErr)
    return new Response(
      JSON.stringify({ error: 'Failed to mark payment as paid' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
