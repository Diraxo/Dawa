// Supabase Edge Function — agora-token
// Verifies Clerk JWT then returns a signed Agora RTC token for the requested channel.
//
// Required secrets (supabase secrets set KEY=value):
//   AGORA_APP_ID          — from Agora console
//   AGORA_APP_CERTIFICATE — from Agora console
//   CLERK_FRONTEND_API    — e.g. https://expert-gazelle-19.clerk.accounts.dev

import { createRemoteJWKSet, jwtVerify } from 'npm:jose'
import { RtcTokenBuilder, RtcRole } from 'npm:agora-access-token'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
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

  try {
    await jwtVerify(clerkToken, jwks)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Parse request body
  let channelName: string
  let uid: number
  try {
    const body = await req.json()
    channelName = body.channelName
    uid = Number(body.uid)
    if (!channelName || isNaN(uid)) throw new Error('invalid')
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body must include channelName (string) and uid (number)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const appId = Deno.env.get('AGORA_APP_ID')!
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE')!
  const expiresInSeconds = 3600 // 1 hour

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expiresInSeconds
  )

  return new Response(
    JSON.stringify({ token }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
