// Supabase Edge Function — freeze-consultation-channel
// Called by a Postgres trigger (via pg_net, using the vault service-role key)
// the instant a consultation's status flips to 'completed'.
//
// This is the server-side enforcement point for chat locking. It uses the
// Stream Chat *server* SDK (API secret, never exposed to clients) to lock the
// consultation's channel down in two layers:
//
//   1. `frozen: true` — Stream's built-in channel freeze. Confirmed (by a live
//      test against this project's Stream app) to reject reactions server-side.
//   2. Both members are demoted to a custom, channel-scoped role
//      (`consultation_locked`) that has no grants at all except reading
//      channel history. This is the layer that actually blocks new messages:
//      a live test showed that `frozen` alone did NOT reject `sendMessage`
//      on this app's current 'messaging' channel-type policy set (only
//      reactions were rejected by `frozen` here), so the role demotion closes
//      that gap with an unconditional, RBAC-level deny that doesn't depend on
//      the ambiguous frozen-state wiring of any single policy.
//
// Neither layer touches any other role's permissions — the custom role and
// its single "allow ReadChannel" policy are additive and only ever apply to
// members explicitly demoted to it.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   STREAM_API_KEY             — from getstream.io dashboard
//   STREAM_API_SECRET          — from getstream.io dashboard (server-only, never sent to clients)
//   SUPABASE_URL               — provided automatically by the platform
//   SUPABASE_SERVICE_ROLE_KEY  — provided automatically by the platform

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { StreamChat } from 'npm:stream-chat'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LOCKED_ROLE = 'consultation_locked'
const LOCKED_POLICY_NAME = 'consultation-locked-read-only'

interface Payload {
  consultation_id: string
}

// Ensures the read-only channel role exists and that the 'messaging' channel
// type grants it exactly one thing: ReadChannel. Idempotent — safe to call on
// every freeze. Never removes or modifies any other role's policies.
async function ensureLockedRole(streamClient: StreamChat) {
  try {
    await streamClient.createRole(LOCKED_ROLE)
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (!/already exists|duplicate/i.test(msg)) throw err
  }

  const channelType = await streamClient.getChannelType('messaging')
  const existing = ((channelType as any).permissions ?? []) as any[]
  const withoutOurs = existing.filter((p) => p?.name !== LOCKED_POLICY_NAME)

  const readOnlyPolicy = {
    name: LOCKED_POLICY_NAME,
    action: 'Allow',
    owner: false,
    priority: 1,
    resources: ['ReadChannel'],
    roles: [LOCKED_ROLE],
  }

  await streamClient.updateChannelType('messaging', {
    permissions: [...withoutOurs, readOnlyPolicy],
  } as any)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // This function is only ever legitimately invoked by the on_consultation_change
  // DB trigger (via pg_net, authenticating with the vault service-role key) the
  // instant a consultation completes. Reject anything else — otherwise any
  // caller could re-trigger channel locking for a consultation not theirs.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (bearerToken !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response('Forbidden', { status: 403 })
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

  // Defense in depth: only ever lock a channel for a consultation that is
  // actually completed, even if this function is ever invoked incorrectly.
  const { data: consult, error } = await supabase
    .from('consultations')
    .select(`
      id,
      status,
      patient:users!patient_id ( clerk_id ),
      doctor_profile:doctor_profiles!doctor_id ( user:users ( clerk_id ) )
    `)
    .eq('id', consultation_id)
    .single()

  if (error || !consult) {
    return new Response(
      JSON.stringify({ error: 'Consultation not found', detail: error?.message }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  if ((consult as any).status !== 'completed') {
    return new Response(
      JSON.stringify({ error: 'Consultation is not completed — refusing to lock channel' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const patientClerkId = (consult as any).patient?.clerk_id as string | undefined
  const doctorClerkId = (consult as any).doctor_profile?.user?.clerk_id as string | undefined

  const streamClient = new StreamChat(
    Deno.env.get('STREAM_API_KEY')!,
    Deno.env.get('STREAM_API_SECRET')!,
  )

  try {
    await ensureLockedRole(streamClient)

    const channel = streamClient.channel('messaging', consultation_id)
    await channel.update({ frozen: true, consultationStatus: 'completed' } as object)

    const members = [patientClerkId, doctorClerkId]
      .filter((id): id is string => !!id)
      .map((user_id) => ({ user_id, channel_role: LOCKED_ROLE }))
    if (members.length > 0) {
      await channel.addMembers(members as any)
    }
  } catch (err) {
    console.error('[freeze-consultation-channel] Stream lock failed:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to lock Stream channel', detail: String(err) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  return new Response(
    JSON.stringify({ consultation_id, frozen: true, locked_members: !!(patientClerkId && doctorClerkId) }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
