// Supabase Edge Function — generate-stream-token
// Called by the mobile app after Clerk sign-in.
// Verifies the Clerk JWT, extracts the user ID, and returns a Stream Chat token.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   STREAM_API_KEY     — from getstream.io dashboard
//   STREAM_API_SECRET  — from getstream.io dashboard
//   CLERK_FRONTEND_API — e.g. https://expert-gazelle-19.clerk.accounts.dev

import { createRemoteJWKSet, jwtVerify } from 'npm:jose'
import { StreamChat } from 'npm:stream-chat'

const streamClient = StreamChat.getInstance(
  Deno.env.get('STREAM_API_KEY')!,
  Deno.env.get('STREAM_API_SECRET')!
)

const ALLOWED_ORIGINS = new Set(['https://dawa.com', 'http://localhost:3000', 'http://localhost:19006'])
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dawa.com',
    'Access-Control-Allow-Headers': 'authorization, content-type',
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const clerkToken = authHeader.slice(7)
  const clerkFrontendApi = Deno.env.get('CLERK_FRONTEND_API')!
  const jwks = createRemoteJWKSet(new URL(`${clerkFrontendApi}/.well-known/jwks.json`))

  let userId: string
  try {
    const { payload } = await jwtVerify(clerkToken, jwks)
    userId = payload.sub!
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const token = streamClient.createToken(userId)

  return new Response(
    JSON.stringify({ token, userId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
