// Supabase Edge Function — upload-profile-photo
//
// Supabase Storage's own JWT verification does not currently honor
// third-party (Clerk) RS256 tokens the way the Data API does: a
// directly-authenticated client.storage.upload()/remove() call against the
// `profile-photos` bucket always fails with "new row violates row-level
// security policy" (auth.jwt()->>'sub' comes back unpopulated inside
// Storage's RLS check) even though the identical Clerk token authenticates
// every DB query fine. This matches the open, unresolved
// supabase/supabase#34948. This function verifies the Clerk token itself
// (same jose/JWKS pattern as agora-token, apply-credit, etc.) and performs
// the Storage write with the service-role key, bypassing Storage's broken
// third-party JWT check entirely.
//
// POST   body = raw image bytes, Content-Type: image/jpeg|image/png
//        ?name=avatar|profile (default avatar) — matches each screen's
//        existing filename convention
//        -> { url, ext }
// DELETE removes every file in the caller's folder (explicit "remove photo",
//        and account-deletion cleanup)
//        -> { ok: true }
//
// Required secrets (supabase secrets set KEY=value):
//   CLERK_FRONTEND_API — e.g. https://clerk.dawaapp.online
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided to edge functions

import { createRemoteJWKSet, jwtVerify } from 'npm:jose'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'profile-photos'
const MAX_SIZE = 5 * 1024 * 1024
const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }

const ALLOWED_ORIGINS = new Set(['https://dawa.com', 'http://localhost:3000', 'http://localhost:19006'])
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dawa.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  }
}

async function verifyClerkToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const clerkFrontendApi = Deno.env.get('CLERK_FRONTEND_API')!
  const jwks = createRemoteJWKSet(new URL(`${clerkFrontendApi}/.well-known/jwks.json`))
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), jwks)
    return (payload.sub as string) ?? null
  } catch {
    return null
  }
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  const CORS = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sub = await verifyClerkToken(req)
  if (!sub) return jsonResponse({ error: 'Invalid or expired token' }, 401, CORS)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  if (req.method === 'DELETE') {
    const { data: existing, error: listErr } = await supabaseAdmin.storage.from(BUCKET).list(sub)
    if (listErr) return jsonResponse({ error: listErr.message }, 500, CORS)
    if (existing && existing.length > 0) {
      const { error: removeErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .remove(existing.map((f) => `${sub}/${f.name}`))
      if (removeErr) return jsonResponse({ error: removeErr.message }, 500, CORS)
    }
    return jsonResponse({ ok: true }, 200, CORS)
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  const ext = MIME_TO_EXT[req.headers.get('Content-Type') ?? '']
  if (!ext) return jsonResponse({ error: 'Only image/jpeg and image/png are allowed' }, 400, CORS)

  const buffer = await req.arrayBuffer()
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_SIZE) {
    return jsonResponse({ error: 'File must be non-empty and at most 5 MB' }, 400, CORS)
  }

  const url = new URL(req.url)
  // Registration uploads to `profile.<ext>`, every other screen to
  // `avatar.<ext>` — preserved as-is rather than unified.
  const baseName = url.searchParams.get('name') === 'profile' ? 'profile' : 'avatar'
  const path = `${sub}/${baseName}.${ext}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: req.headers.get('Content-Type')!, upsert: true })
  if (uploadError) return jsonResponse({ error: uploadError.message }, 500, CORS)

  // Clean up any file left behind under a different extension by a previous
  // upload (e.g. switched from a PNG photo to a JPEG one) — best-effort.
  const { data: existing } = await supabaseAdmin.storage.from(BUCKET).list(sub)
  const stale = (existing ?? []).filter((f) => f.name !== `${baseName}.${ext}`)
  if (stale.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(stale.map((f) => `${sub}/${f.name}`))
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return jsonResponse({ url: `${urlData.publicUrl}?v=${Date.now()}`, ext }, 200, CORS)
})
