// Supabase Edge Function — notify-security-event
//
// Client-callable (Clerk JWT), unlike handle-consultation-notification /
// send-appointment-notification which are deliberately DB-trigger-only.
// Scoped to exactly one thing: an account-security event the client itself
// just performed (currently: password changed) that has no corresponding
// DB row change for a trigger to observe. The caller's identity is derived
// from the verified JWT, never trusted from the request body — the same
// lesson migration 089 fixed for reclaim_push_token.
//
// POST body: { kind: 'password_changed' }

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

const COPY: Record<string, { title: string; body: string }> = {
  password_changed: {
    title: 'Password Updated',
    body:  "Your account password was changed successfully. If this wasn't you, contact support immediately.",
  },
}

async function sendExpoPush(token: string, title: string, body: string, data: Record<string, unknown>, badge: number): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: token, channelId: 'consultations', title, body, data, sound: 'default', priority: 'normal', badge }),
    })
  } catch (e) {
    console.warn('[notify-security-event] push send failed:', e)
  }
}

Deno.serve(async (req: Request) => {
  const CORS = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  const clerkToken = authHeader.slice(7)
  const clerkFrontendApi = Deno.env.get('CLERK_FRONTEND_API')!
  const jwks = createRemoteJWKSet(new URL(`${clerkFrontendApi}/.well-known/jwks.json`))
  let clerkSub: string
  try {
    const { payload } = await jwtVerify(clerkToken, jwks)
    clerkSub = payload.sub!
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  let body: { kind?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS })
  }

  const copy = body.kind ? COPY[body.kind] : undefined
  if (!copy) {
    return new Response(JSON.stringify({ error: 'Unknown or missing kind' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, push_token')
    .eq('clerk_id', clerkSub)
    .maybeSingle()

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const { data: inserted } = await supabase
    .from('notifications')
    .insert({
      user_id:   (user as any).id,
      title:     copy.title,
      body:      copy.body,
      type:      body.kind,
      data_json: { screen: 'profile' },
    })
    .select('id')
    .single()

  // "account" is the same preference category the Account & Security toggle
  // in notification-settings.tsx already writes — reused here rather than
  // adding a new column. Push is skipped when disabled; the in-app row above
  // is always created regardless.
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('account')
    .eq('user_id', (user as any).id)
    .maybeSingle()
  const pushEnabled = !prefs || (prefs as any).account !== false

  const token = (user as any).push_token
  if (token && pushEnabled) {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', (user as any).id)
      .is('read_at', null)
    await sendExpoPush(token, copy.title, copy.body, { screen: 'profile', notificationId: inserted?.id ?? '' }, count ?? 1)
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
