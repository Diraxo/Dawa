// Supabase Edge Function — chapa-webhook
// Chapa calls this URL two ways:
//   1. Server-to-server POST (callback_url) — immediately after payment
//   2. Browser GET redirect (return_url for mobile) — after the user sees payment success
// Both paths verify with Chapa and update the DB. The UPDATE is idempotent
// (WHERE payment_status != 'paid') so the doctor only gets one notification.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Minimal, self-contained Expo push send — mirrors the other edge functions'
// sendPushNotification but without the FCM/VoIP/dedupe machinery those need
// for ringing calls, which payment notifications never are. Never throws —
// a failed push must not affect the payment-verification response.
async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  badge: number,
): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: token, channelId: 'consultations', title, body, data, sound: 'default', priority: 'normal', badge }),
    })
  } catch (e) {
    console.warn('[chapa-webhook] push send failed:', e)
  }
}

async function getUnreadBadgeCount(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return 1
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 1
}

async function isPushEnabled(
  supabase: ReturnType<typeof createClient>,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false
  const { data } = await supabase
    .from('notification_preferences')
    .select('consultation_request')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return true
  return (data as any).consultation_request !== false
}

// Payment Successful / Payment Failed fallback notifications (spec issues
// 5/6) — the payment-return screen already shows this synchronously, but a
// patient who leaves the external Chapa browser/app before returning never
// sees it. Both callers guard "only once" by only calling this when their
// own idempotent status-flip UPDATE actually matched a row (see call sites).
async function notifyPaymentOutcome(
  supabase: ReturnType<typeof createClient>,
  outcome: 'success' | 'failed',
  row: { id: string; patient_id: string | null; doctor_id: string | null },
): Promise<void> {
  const patientId = row.patient_id
  if (!patientId) return

  const title = outcome === 'success' ? 'Payment Successful' : 'Payment Failed'
  const body  = outcome === 'success'
    ? 'Your consultation request has been received successfully.'
    : 'Your payment could not be completed. Please try again.'
  const dataJson = outcome === 'success'
    ? { screen: 'waiting', consultationId: row.id }
    : { screen: 'booking', consultationId: row.id, doctorId: row.doctor_id ?? '' }

  const { data: inserted } = await supabase
    .from('notifications')
    .insert({ user_id: patientId, title, body, type: `payment_${outcome}`, data_json: dataJson })
    .select('id')
    .single()

  const { data: patientRow } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', patientId)
    .maybeSingle()

  const token = (patientRow as any)?.push_token
  if (token && await isPushEnabled(supabase, patientId)) {
    await sendExpoPush(token, title, body, { ...dataJson, notificationId: inserted?.id ?? '' }, await getUnreadBadgeCount(supabase, patientId))
  }
}

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
    console.error('[chapa-webhook] CHAPA_SECRET_KEY is not set in this environment')
    return new Response('Payment service not configured', { status: 500 })
  }
  const maskedKey = chapaKey.length > 12
    ? `${chapaKey.slice(0, 12)}${'*'.repeat(chapaKey.length - 12)}`
    : '***'
  console.log(`[chapa-webhook] Chapa key loaded=${maskedKey} verifying tx_ref=${trx_ref}`)

  // Verify with Chapa — never trust the webhook alone without verification
  let verifyData: ChapaVerifyResponse
  try {
    const resp = await fetch(`https://api.chapa.co/v1/transaction/verify/${trx_ref}`, {
      headers: { 'Authorization': `Bearer ${chapaKey}` },
    })
    verifyData = await resp.json() as ChapaVerifyResponse
    console.log('[chapa-webhook] Chapa verify HTTP status:', resp.status)
    console.log('[chapa-webhook] Chapa verify response body:', JSON.stringify(verifyData))
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

    // Release the reserved slot immediately instead of leaving it locked
    // until the 10-minute slot_locks TTL / 30-minute stale-payment cron
    // sweep gets to it — a failed payment must free the slot for other
    // patients right away, per the "release slot automatically" requirement.
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { data: failedRow } = await supabase
        .from('consultations')
        .select('id, patient_id, doctor_id')
        .eq('chapa_tx_ref', trx_ref)
        .eq('status', 'pending_payment')
        .maybeSingle()

      if (failedRow?.id) {
        await supabase.from('slot_locks').delete().eq('consultation_id', failedRow.id)
        // .select() here tells us whether THIS call performed the cancel —
        // guards the fallback notification below to fire exactly once even
        // if this webhook is invoked more than once for the same failed tx
        // (Chapa retry, or both the GET redirect and a POST callback landing).
        const { data: cancelledRows } = await supabase
          .from('consultations')
          .update({ status: 'cancelled', payment_status: 'failed' })
          .eq('id', failedRow.id)
          .eq('status', 'pending_payment')
          .select('id')

        if (cancelledRows && cancelledRows.length > 0) {
          await notifyPaymentOutcome(supabase, 'failed', failedRow as any)
        }
      }
    } catch (err) {
      console.error('[chapa-webhook] immediate slot release on payment failure failed:', err)
    }

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
  // .select() also tells us whether THIS call was the one that performed the
  // flip — used below to fire the Payment Successful fallback notification
  // (spec issue 5) exactly once, never on a second/idempotent-no-op call.
  const { data: paidRows, error } = await supabase
    .from('consultations')
    .update({ payment_status: 'paid' })
    .eq('chapa_tx_ref', trx_ref)
    .neq('payment_status', 'paid')
    .select('id, patient_id, doctor_id')

  if (error) {
    console.error('[chapa-webhook] DB update error:', error)
    if (req.method === 'GET') {
      return new Response(FAILED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
    return new Response('DB update failed', { status: 500 })
  }

  if (paidRows && paidRows.length > 0) {
    try {
      await notifyPaymentOutcome(supabase, 'success', paidRows[0] as any)
    } catch (e) {
      console.warn('[chapa-webhook] Payment Successful fallback notification failed:', e)
    }
  }

  // Resilience fallback: normally the client (payment-return screens) flips
  // status from 'pending_payment' to 'scheduled'/'waiting_for_doctor' itself
  // right after verifying payment. If the client is killed or loses network
  // in that window, the row is stuck at 'pending_payment' forever — invisible
  // to every doctor-facing query (Upcoming Appointments, Today's Schedule)
  // and no booking/reschedule notification ever fires. Attempt the same flip
  // here too.
  //
  // Also covers 'cancelled': the client gives up and writes status='cancelled'
  // whenever it can't confirm payment itself (crash, timeout, dropped network,
  // the user's own "I didn't complete payment" button) — all of that happens
  // on the client's own incomplete view of the world, racing against Chapa's
  // real settlement, which can still land here afterward. Without this, that
  // race leaves a row permanently stuck at payment_status='paid' AND
  // status='cancelled': the patient was actually charged but the doctor was
  // never notified, no waiting room ever appears, and nothing is scheduled —
  // silent money-captured-nothing-happens, requiring manual support to find
  // and fix. Recoverable here because every client-side cancel path only ever
  // fires from 'pending_payment' (before the consultation ever went live), so
  // waiting_started_at is guaranteed still null; a cancel of a consultation
  // that *had* already reached the waiting room (a deliberate, later,
  // unrelated cancellation) always has waiting_started_at set and is
  // correctly left alone.
  //
  // cancelled_by IS NULL is the second, independent guard: every payment-race
  // auto-cancel above (BookingModal.tsx catch block, payment-return.tsx
  // cancelConsultationById) writes status='cancelled' WITHOUT cancelled_by —
  // it's the client giving up on its own uncertain view, not an attributed
  // decision. A genuine cancellation — patient's own waiting-room "Cancel"
  // button, or an admin cancelling via carehub-web's admin console — always
  // sets cancelled_by (migration 040) to the acting user's id. Admin cancels
  // in particular can hit a 'scheduled' (future, paid, pre-waiting-room) row,
  // which also has waiting_started_at still null, so without this check a
  // delayed webhook could resurrect a consultation an admin deliberately
  // cancelled. Once cancelled_by is set, this fallback must never touch the
  // row again — the cancellation was intentional, not a race artifact.
  try {
    const { data: recoverableRow } = await supabase
      .from('consultations')
      .select('id, created_at, scheduled_at, is_on_demand, patient_amount')
      .eq('chapa_tx_ref', trx_ref)
      .in('status', ['pending_payment', 'cancelled'])
      .is('waiting_started_at', null)
      .is('cancelled_by', null)
      .maybeSingle()

    if (recoverableRow?.scheduled_at && recoverableRow?.created_at) {
      // is_on_demand is set once, authoritatively, by book_appointment_slot()
      // at booking time — read directly. Falls back to the proximity
      // heuristic only for rows booked before that column existed.
      const isOnDemand = recoverableRow.is_on_demand != null
        ? recoverableRow.is_on_demand
        : Math.abs(
            new Date(recoverableRow.scheduled_at).getTime() - new Date(recoverableRow.created_at).getTime()
          ) < 60_000

      const { error: resurrectError } = await supabase
        .from('consultations')
        .update({
          status: isOnDemand ? 'waiting_for_doctor' : 'scheduled',
          ...(isOnDemand ? { waiting_started_at: new Date().toISOString() } : {}),
        })
        .eq('id', recoverableRow.id)
        .in('status', ['pending_payment', 'cancelled'])
        .is('waiting_started_at', null)
        .is('cancelled_by', null)

      // uq_consultations_doctor_slot (migration 044) rejects this specific
      // update if another patient already took the same doctor/slot while
      // this row sat cancelled waiting on a late webhook — the patient here
      // was genuinely charged (payment_status was just flipped to 'paid'
      // above) but the appointment itself is gone. Previously this was a
      // bare console.error, silently leaving the row stuck 'cancelled' with
      // payment_status='paid' and no compensation. Credit is this app's only
      // compensation mechanism (see set_consultation_credit_on_decline) —
      // issue it directly here since this row's own status isn't changing
      // (it stays 'cancelled', so the normal decline/cancel trigger never
      // fires for it).
      if (resurrectError?.code === '23505') {
        console.error(
          `[chapa-webhook] slot ${recoverableRow.id} was retaken before its late payment confirmation landed — issuing credit instead of resurrecting`,
          resurrectError,
        )
        await supabase
          .from('consultations')
          .update({
            consultation_credit: true,
            credit_amount: recoverableRow.patient_amount ?? 0,
          })
          .eq('id', recoverableRow.id)
          .eq('consultation_credit', false)
      } else if (resurrectError) {
        console.error('[chapa-webhook] status-flip fallback failed:', resurrectError)
      }
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
