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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
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

  const { patient_clerk_id, credit_consultation_id, new_consultation_id } = body
  if (!patient_clerk_id || !credit_consultation_id || !new_consultation_id) {
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
      patient_amount,
      payment_status,
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

  // ── Apply credit ───────────────────────────────────────────────────────────

  if (newFee <= creditAmount) {
    // Full coverage — mark credit used, mark new consultation paid + waiting
    await supabase
      .from('consultations')
      .update({ credit_used: true })
      .eq('id', credit_consultation_id)

    await supabase
      .from('consultations')
      .update({
        payment_status:   'paid',
        status:           'waiting_for_doctor',
        credit_source_id: credit_consultation_id,
      })
      .eq('id', new_consultation_id)

    return new Response(
      JSON.stringify({ success: true, covered: 'full', creditApplied: creditAmount }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // Partial coverage — record credit source; caller initiates Chapa for difference.
  // The chapa-webhook marks credit_used=true once the difference payment is confirmed.
  const additionalRequired = newFee - creditAmount

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
