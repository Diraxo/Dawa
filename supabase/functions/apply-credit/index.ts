// Supabase Edge Function — apply-credit
// Applies a consultation credit (from a doctor-declined paid consultation) to a
// new booking. Validates ownership, prevents double-use, and handles two cases:
//
//   covered = 'full'    new fee ≤ credit — no Chapa payment needed;
//                       new consultation is marked paid + waiting_for_doctor.
//
//   covered = 'partial' new fee > credit — credit_source_id is recorded on the
//                       new consultation so the webhook can mark it used once
//                       the Chapa difference payment is confirmed.
//
// POST body:
//   patient_clerk_id        string  — Clerk user ID of the patient
//   credit_consultation_id  string  — declined consultation that holds the credit
//   new_consultation_id     string  — new consultation to apply credit to

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose'

const ALLOWED_ORIGINS = new Set(['https://dawa.com', 'http://localhost:3000', 'http://localhost:19006'])
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dawa.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

Deno.serve(async (req: Request) => {
  const CORS = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  // Verify the caller's own Clerk session — this endpoint moves a paid
  // consultation's credit onto another consultation, so patient_clerk_id
  // must come from a verified token, not be trusted as a body field.
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

  let body: {
    patient_clerk_id:       string
    credit_consultation_id: string
    new_consultation_id:    string
  }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS })
  }

  const { credit_consultation_id, new_consultation_id } = body
  const patient_clerk_id = clerkSub
  if (body.patient_clerk_id && body.patient_clerk_id !== clerkSub) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
  if (!credit_consultation_id || !new_consultation_id) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Validate credit consultation ──────────────────────────────────────────

  const { data: creditConsult, error: creditErr } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      consultation_credit,
      credit_amount,
      credit_used,
      patient:users!patient_id ( clerk_id )
    `)
    .eq('id', credit_consultation_id)
    .single()

  if (creditErr || !creditConsult) {
    return new Response(
      JSON.stringify({ error: 'Credit consultation not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const creditPatientClerkId = (creditConsult.patient as any)?.clerk_id
  if (creditPatientClerkId !== patient_clerk_id) {
    return new Response(
      JSON.stringify({ error: 'Credit does not belong to this patient' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  if (!(creditConsult as any).consultation_credit) {
    return new Response(
      JSON.stringify({ error: 'No credit available on this consultation' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  if ((creditConsult as any).credit_used) {
    return new Response(
      JSON.stringify({ error: 'Credit has already been used' }),
      { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const creditAmount = Number((creditConsult as any).credit_amount ?? 0)

  // ── Validate new consultation ─────────────────────────────────────────────

  const { data: newConsult, error: newErr } = await supabase
    .from('consultations')
    .select(`
      id,
      type,
      patient_amount,
      payment_status,
      scheduled_at,
      is_on_demand,
      patient:users!patient_id ( clerk_id )
    `)
    .eq('id', new_consultation_id)
    .single()

  if (newErr || !newConsult) {
    return new Response(
      JSON.stringify({ error: 'New consultation not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const newPatientClerkId = (newConsult.patient as any)?.clerk_id
  if (newPatientClerkId !== patient_clerk_id) {
    return new Response(
      JSON.stringify({ error: 'New consultation does not belong to this patient' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const newFee = Number((newConsult as any).patient_amount ?? 0)

  // A credit is tied to the consultation TYPE it was paid for (chat/phone/
  // video), never convertible — a declined video consultation's credit can
  // only be applied to another video booking, so price/refund logic never
  // has to reason about a type mismatch.
  if ((newConsult as any).type !== (creditConsult as any).type) {
    return new Response(
      JSON.stringify({ error: 'Credit can only be applied to the same consultation type it was paid for' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // ── Apply credit ───────────────────────────────────────────────────────────

  if (newFee <= creditAmount) {
    // Full coverage — mark credit used, mark new consultation paid.
    //
    // is_on_demand is set once, authoritatively, by book_appointment_slot()
    // at booking time — read directly rather than re-deriving it from
    // scheduled_at. A prior `scheduled_at > now + 1h` heuristic misclassified
    // any scheduled slot booked less than an hour ahead (common with
    // 20-minute slots) as on-demand, firing the doctor's immediate
    // new_request notification and dropping the patient into the waiting
    // room for an appointment that hadn't started yet.
    const isScheduled = !(newConsult as any).is_on_demand

    // Guard the write with credit_used=false so two near-simultaneous calls
    // for the same credit can't both succeed — only the first claims it.
    const { data: claimed } = await supabase
      .from('consultations')
      .update({ credit_used: true, replacement_consultation_id: new_consultation_id })
      .eq('id', credit_consultation_id)
      .eq('credit_used', false)
      .select('id')

    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Credit has already been used' }),
        { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // waiting_started_at must be stamped here too — it's the sort key doctor
    // clients queue on (earliest first) and what the patient waiting-room
    // displays as "waiting since". The waiting room itself never expires on
    // its own; it only ends via an explicit doctor accept/decline or patient
    // cancel. Scheduled bookings skip this entirely — the scheduled-time cron
    // (trigger_appointment_notifications) flips 'scheduled' -> 'waiting_for_doctor'
    // and stamps waiting_started_at itself once scheduled_at arrives.
    await supabase
      .from('consultations')
      .update({
        payment_status:   'paid',
        status:           isScheduled ? 'scheduled' : 'waiting_for_doctor',
        credit_source_id: credit_consultation_id,
        ...(isScheduled ? {} : { waiting_started_at: new Date().toISOString() }),
      })
      .eq('id', new_consultation_id)

    return new Response(
      JSON.stringify({ success: true, covered: 'full', creditApplied: creditAmount, scheduled: isScheduled }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // Partial coverage — record credit source; caller initiates Chapa for difference.
  // The chapa-webhook marks credit_used=true once the difference payment is confirmed.
  const additionalRequired = newFee - creditAmount

  // Same credit_used=false guard as the full-coverage path — the webhook
  // marks credit_used=true once the difference payment confirms, so this
  // only reserves the credit source; it must not attach to a consultation
  // whose credit was already claimed elsewhere in the meantime.
  const { data: reserved } = await supabase
    .from('consultations')
    .update({ replacement_consultation_id: new_consultation_id })
    .eq('id', credit_consultation_id)
    .eq('credit_used', false)
    .select('id')

  if (!reserved || reserved.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Credit has already been used' }),
      { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  await supabase
    .from('consultations')
    .update({ credit_source_id: credit_consultation_id })
    .eq('id', new_consultation_id)

  return new Response(
    JSON.stringify({
      success:          true,
      covered:          'partial',
      creditApplied:    creditAmount,
      additionalRequired,
    }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
