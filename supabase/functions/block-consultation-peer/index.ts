// Supabase Edge Function — block-consultation-peer
// Verifies Clerk JWT, confirms the caller is a participant on the given
// consultation, then bans the *other* participant from that consultation's
// Stream channel (server-side, using the Stream API secret — never exposed
// to clients) and persists the block in `blocked_users`.
//
// Fixes P3-12: the mobile "Block" button previously only flipped local
// component state — nothing was persisted and the other party was never
// actually prevented from sending messages. The ban here is scoped to this
// one channel (Stream's channel.banUser targets the channel's own type+id,
// not a global ban), matching the existing UI copy ("You will no longer
// receive messages from this doctor/patient. The consultation history is
// preserved.").
//
// Required secrets (supabase secrets set KEY=value):
//   STREAM_API_KEY / STREAM_API_SECRET
//   CLERK_FRONTEND_API
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided to edge functions

import { createRemoteJWKSet, jwtVerify } from 'npm:jose'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { StreamChat } from 'npm:stream-chat'

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
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  let consultationId: string
  try {
    const body = await req.json()
    consultationId = body.consultationId
    if (!consultationId) throw new Error('invalid')
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body must include consultationId (string)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: consult } = await supabase
    .from('consultations')
    .select(`
      id, patient_id, doctor_id,
      patient:users!patient_id ( id, clerk_id ),
      doctor_profile:doctor_profiles!doctor_id ( user:users ( id, clerk_id ) )
    `)
    .eq('id', consultationId)
    .maybeSingle()

  if (!consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const { data: caller } = await supabase
    .from('users')
    .select('id, clerk_id')
    .eq('clerk_id', clerkSub)
    .maybeSingle()

  const patientUser = (consult as any).patient
  const doctorUser = (consult as any).doctor_profile?.user

  let blockerUserId: string | null = null
  let blockedUserId: string | null = null
  let blockedClerkId: string | null = null

  if (caller && patientUser?.id === caller.id) {
    blockerUserId = caller.id
    blockedUserId = doctorUser?.id ?? null
    blockedClerkId = doctorUser?.clerk_id ?? null
  } else if (caller && doctorUser?.id === caller.id) {
    blockerUserId = caller.id
    blockedUserId = patientUser?.id ?? null
    blockedClerkId = patientUser?.clerk_id ?? null
  }

  if (!blockerUserId || !blockedUserId || !blockedClerkId) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const streamClient = new StreamChat(
    Deno.env.get('STREAM_API_KEY')!,
    Deno.env.get('STREAM_API_SECRET')!,
  )

  try {
    // Channel-scoped ban (type + id default to this channel, not a global
    // ban) — prevents the blocked party from sending further messages here
    // while leaving the consultation history intact for both sides.
    const channel = streamClient.channel('messaging', consultationId)
    await channel.banUser(blockedClerkId, { reason: 'blocked by other consultation participant' })
  } catch (err) {
    console.error('[block-consultation-peer] Stream ban failed:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to enforce block', detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const { error: insertError } = await supabase
    .from('blocked_users')
    .upsert(
      { consultation_id: consultationId, blocker_user_id: blockerUserId, blocked_user_id: blockedUserId },
      { onConflict: 'blocker_user_id,blocked_user_id', ignoreDuplicates: true },
    )

  if (insertError) {
    console.error('[block-consultation-peer] persisting block failed:', insertError)
    // The Stream ban already succeeded — don't report failure over a
    // secondary bookkeeping write, but do surface it in logs.
  }

  return new Response(
    JSON.stringify({ blocked: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
