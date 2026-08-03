// Supabase Edge Function — agora-token
// Verifies Clerk JWT then returns a signed Agora RTC token for the requested channel.
//
// channelName is always a consultations.id — before minting a token we verify
// the caller (via Clerk sub -> users.id / doctor_profiles.id, same resolution
// RLS uses) is actually the patient or doctor on that consultation. Without
// this, any authenticated user who learns/guesses a channelName could join
// and publish audio into someone else's call.
//
// Required secrets (supabase secrets set KEY=value):
//   AGORA_APP_ID          — from Agora console
//   AGORA_APP_CERTIFICATE — from Agora console
//   CLERK_FRONTEND_API    — e.g. https://expert-gazelle-19.clerk.accounts.dev
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided to edge functions

import { createRemoteJWKSet, jwtVerify } from 'npm:jose'
import { RtcTokenBuilder, RtcRole } from 'npm:agora-access-token'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Mirrors hooks/useConsultationState.ts's TERMINAL_STATUSES — a narrower set
// here let a stale client mint a token and join a call the counterpart
// already considers over (P3-21).
const INACTIVE_STATUSES = new Set([
  'completed',
  'cancelled',
  'declined',
  'doctor_missed',
  'missed',
  'call_declined',
  'ended_abnormally',
])

// Mirrors lib/agora.ts's uidFromString exactly — the uid is derived here from
// the caller's own verified Clerk subject, never taken from the request body,
// so a caller can never mint a token for another participant's uid (P3-19).
function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return h === 0 ? 1 : h
}

const ALLOWED_ORIGINS = new Set(['https://dawa.com', 'http://localhost:3000', 'http://localhost:19006'])
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dawa.com',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Verify Clerk JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Parse request body
  let channelName: string
  try {
    const body = await req.json()
    channelName = body.channelName
    if (!channelName) throw new Error('invalid')
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body must include channelName (string)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Authorize: caller must be the patient or doctor on the consultation
  // identified by channelName (channelName === consultations.id).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: consultation } = await supabase
    .from('consultations')
    .select('id, patient_id, doctor_id, status')
    .eq('id', channelName)
    .maybeSingle()

  if (!consultation) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: caller } = await supabase
    .from('users')
    .select('id, role')
    .eq('clerk_id', clerkSub)
    .maybeSingle()

  let authorized = false
  if (caller) {
    if (caller.role === 'admin') {
      authorized = true
    } else if (consultation.patient_id === caller.id) {
      authorized = true
    } else {
      const { data: doctorProfile } = await supabase
        .from('doctor_profiles')
        .select('id')
        .eq('user_id', caller.id)
        .maybeSingle()
      authorized = !!doctorProfile && doctorProfile.id === consultation.doctor_id
    }
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (INACTIVE_STATUSES.has(consultation.status)) {
    return new Response(
      JSON.stringify({ error: 'Consultation is no longer active' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // uid is derived from the caller's own verified identity, not the request
  // body — prevents a participant from minting a token for the other party's
  // uid and force-disconnecting them mid-call.
  const uid = uidFromString(clerkSub)

  const appId = Deno.env.get('AGORA_APP_ID')!
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE')!
  // privilegeExpireTs must be an absolute Unix timestamp (seconds since epoch)
  const now = Math.floor(Date.now() / 1000)
  const privilegeExpireTs = now + 3600

  console.log('[agora-token] Current Unix Time:', now)
  console.log('[agora-token] Privilege Expire Time:', privilegeExpireTs)
  console.log('[agora-token] Seconds Until Expiration:', privilegeExpireTs - now)
  console.log('[agora-token] Channel:', channelName)
  console.log('[agora-token] UID:', uid)
  console.log('[agora-token] App ID length:', appId.length, '| App ID prefix:', appId.slice(0, 4))

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpireTs
  )

  return new Response(
    JSON.stringify({ token, expiresAt: privilegeExpireTs }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
