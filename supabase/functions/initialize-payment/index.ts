// Supabase Edge Function — initialize-payment
// Called by the mobile app and website to start a Chapa checkout session.
// Returns a checkout_url the client opens, and saves the tx_ref to the
// consultation record immediately so the webhook trigger can fire.
// Also accepts an optional credit_source_id for partial-credit bookings
// where only the difference amount is charged via Chapa.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Payload {
  consultation_id:  string
  amount:           number
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS })
  }

  const { consultation_id, amount, email, first_name, last_name, type, doctor_name, return_url, credit_source_id } = payload
  if (!consultation_id || !amount || !email || !return_url) {
    return new Response('Missing required fields', { status: 400, headers: CORS })
  }

  const chapaKey = Deno.env.get('CHAPA_SECRET_KEY')
  if (!chapaKey) {
    return new Response('Payment service not configured', { status: 500, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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

    if (!resp.ok || chapaData.status !== 'success' || !chapaData.data?.checkout_url) {
      // Log everything: HTTP status from Chapa + full body
      console.error('[initialize-payment] Chapa HTTP status:', resp.status)
      console.error('[initialize-payment] Chapa response:', JSON.stringify(chapaData))
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
