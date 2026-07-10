// Supabase Edge Function — chapa-webhook
// Chapa calls this URL two ways:
//   1. Server-to-server POST (callback_url) — immediately after payment
//   2. Browser GET redirect (return_url for mobile) — after the user sees payment success
// Both paths verify with Chapa and update the DB. The UPDATE is idempotent
// (WHERE payment_status != 'paid') so the doctor only gets one notification.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ChapaVerifyResponse {
  status: string
  data?: {
    status: string    // 'success' | 'failed'
    tx_ref: string
    amount: number
  }
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Confirmed</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:360px;width:90%;
        box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}
  .icon{font-size:52px;margin-bottom:16px}
  h2{margin:0 0 10px;color:#111827;font-size:20px}
  p{margin:0;color:#6b7280;font-size:14px;line-height:1.6}
  .badge{display:inline-block;margin-top:20px;padding:8px 20px;border-radius:999px;
         background:linear-gradient(90deg,#2962ff,#00bfa5);color:#fff;font-size:13px;font-weight:600}
</style>
</head>
<body>
<div class="card">
  <div class="icon">✅</div>
  <h2>Payment Confirmed!</h2>
  <p>Your payment was successful. You can now close this tab and return to the Dawa app to continue.</p>
  <div class="badge">Return to Dawa</div>
</div>
</body>
</html>`

const FAILED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Not Completed</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:360px;width:90%;
        box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}
  .icon{font-size:52px;margin-bottom:16px}
  h2{margin:0 0 10px;color:#111827;font-size:20px}
  p{margin:0;color:#6b7280;font-size:14px;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="icon">❌</div>
  <h2>Payment Not Completed</h2>
  <p>Your payment was not confirmed. Please return to the Dawa app and try booking again. No charge was made.</p>
</div>
</body>
</html>`

Deno.serve(async (req: Request) => {
  // Chapa sends GET or POST depending on configuration; handle both
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // For GET webhook callbacks, tx_ref may be in query params
  const url = new URL(req.url)
  let trx_ref = url.searchParams.get('trx_ref') ?? url.searchParams.get('tx_ref')

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      // tx_ref is OUR reference (what we sent to Chapa and stored as chapa_tx_ref).
      // trx_ref is Chapa's internal reference — different value, not in our DB.
      // Chapa's verify API also expects our tx_ref, not their trx_ref.
      trx_ref = trx_ref ?? body.tx_ref ?? body.trx_ref
    } catch {
      // body might be empty for GET-style callbacks
    }
  }

  // Detect browser redirect: GET with no tx_ref and Accept: text/html
  // (e.g. user opened this URL directly). Return the failed page gracefully.
  if (!trx_ref) {
    if (req.method === 'GET') {
      return new Response(FAILED_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    return new Response('Missing tx_ref', { status: 400 })
  }

  const chapaKey = Deno.env.get('CHAPA_SECRET_KEY')
  if (!chapaKey) {
    return new Response('Payment service not configured', { status: 500 })
  }

  // Verify with Chapa — never trust the webhook alone without verification
  let verifyData: ChapaVerifyResponse
  try {
    const resp = await fetch(`https://api.chapa.co/v1/transaction/verify/${trx_ref}`, {
      headers: { 'Authorization': `Bearer ${chapaKey}` },
    })
    verifyData = await resp.json() as ChapaVerifyResponse
  } catch (err) {
    console.error('[chapa-webhook] Verify error:', err)
    if (req.method === 'GET') {
      return new Response(FAILED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
    return new Response('Verification failed', { status: 500 })
  }

  const paid = verifyData.status === 'success' && verifyData.data?.status === 'success'

  if (!paid) {
    console.warn('[chapa-webhook] Payment not successful:', verifyData)
    if (req.method === 'GET') {
      return new Response(FAILED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
    return new Response(JSON.stringify({ received: true, paid: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Idempotent update: skip if payment_status is already 'paid' so the DB
  // trigger (migration 009) only fires once even when both the server webhook
  // and the browser redirect hit this function for the same transaction.
  const { error } = await supabase
    .from('consultations')
    .update({ payment_status: 'paid' })
    .eq('chapa_tx_ref', trx_ref)
    .neq('payment_status', 'paid')

  if (error) {
    console.error('[chapa-webhook] DB update error:', error)
    if (req.method === 'GET') {
      return new Response(FAILED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
    return new Response('DB update failed', { status: 500 })
  }

  // Resilience fallback: normally the client (payment-return screens) flips
  // status from 'pending_payment' to 'scheduled'/'waiting_for_doctor' itself
  // right after verifying payment. If the client is killed or loses network
  // in that window, the row is stuck at 'pending_payment' forever — invisible
  // to every doctor-facing query (Upcoming Appointments, Today's Schedule)
  // and no booking/reschedule notification ever fires. Attempt the same flip
  // here too, guarded to only ever touch a row still at 'pending_payment' —
  // a no-op once the client's own fast path already ran.
  try {
    const { data: pendingRow } = await supabase
      .from('consultations')
      .select('id, created_at, scheduled_at')
      .eq('chapa_tx_ref', trx_ref)
      .eq('status', 'pending_payment')
      .maybeSingle()

    if (pendingRow?.scheduled_at && pendingRow?.created_at) {
      // "Now" bookings are inserted with scheduled_at == the booking moment
      // (see BookingModal: p_slot_start = new Date().toISOString() when
      // timing === 'now'), so scheduled_at sitting within ~1 minute of
      // created_at reliably identifies an on-demand booking without needing
      // a dedicated column.
      const isOnDemand = Math.abs(
        new Date(pendingRow.scheduled_at).getTime() - new Date(pendingRow.created_at).getTime()
      ) < 60_000

      await supabase
        .from('consultations')
        .update({
          status: isOnDemand ? 'waiting_for_doctor' : 'scheduled',
          ...(isOnDemand ? { waiting_started_at: new Date().toISOString() } : {}),
        })
        .eq('id', pendingRow.id)
        .eq('status', 'pending_payment')
    }
  } catch (err) {
    console.error('[chapa-webhook] status-flip fallback failed:', err)
  }

  // If this consultation is a partial-credit booking, mark the source credit as used now
  // that the difference payment has been confirmed by Chapa.
  try {
    const { data: paidConsult } = await supabase
      .from('consultations')
      .select('credit_source_id')
      .eq('chapa_tx_ref', trx_ref)
      .single()

    if (paidConsult?.credit_source_id) {
      await supabase
        .from('consultations')
        .update({ credit_used: true })
        .eq('id', paidConsult.credit_source_id)
        .eq('credit_used', false)
    }
  } catch {
    // best effort — credit cleanup is not critical for payment confirmation
  }

  // Browser redirect (mobile return_url) — show a nice confirmation page
  if (req.method === 'GET') {
    return new Response(SUCCESS_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Server-to-server webhook — return JSON for Chapa's logging
  return new Response(
    JSON.stringify({ received: true, paid: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
