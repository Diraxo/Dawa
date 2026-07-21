import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_LOCK_DURATION = 30 * 60 * 1000

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
  const cors = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const body = await req.json().catch(() => null)
  if (!body?.operation || !body?.identifier) {
    return json({ error: 'Missing required fields' }, 400)
  }

  const { operation, identifier, attempt_type = 'login', options = {} } = body
  const maxAttempts: number = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const lockDuration: number = options.lockDuration ?? DEFAULT_LOCK_DURATION
  const now = new Date()

  try {
    if (operation === 'check') {
      return json(await checkLimit(identifier, attempt_type, maxAttempts, now), 200)
    }

    if (operation === 'record_failure') {
      await recordFailure(identifier, attempt_type, maxAttempts, lockDuration, now)
      return json(await checkLimit(identifier, attempt_type, maxAttempts, now), 200)
    }

    if (operation === 'record_success') {
      await supabase.from('rate_limits')
        .delete()
        .eq('identifier', identifier)
        .eq('attempt_type', attempt_type)
      return json({ allowed: true }, 200)
    }

    return json({ error: 'Invalid operation' }, 400)
  } catch (err) {
    console.error('[rate-limit]', err)
    // Fail open so auth is never fully blocked by a limiter outage
    return json({ allowed: true, remainingAttempts: maxAttempts }, 500)
  }
})

async function checkLimit(
  identifier: string,
  attemptType: string,
  maxAttempts: number,
  now: Date,
) {
  const { data } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('attempt_type', attemptType)
    .maybeSingle()

  if (!data) return { allowed: true, remainingAttempts: maxAttempts }

  // Still locked?
  if (data.locked_until && new Date(data.locked_until) > now) {
    const msLeft = new Date(data.locked_until).getTime() - now.getTime()
    const minutesLeft = Math.ceil(msLeft / 60000)
    return {
      allowed: false,
      lockedUntil: data.locked_until,
      message: `Too many failed attempts. Try again in ${minutesLeft} minutes.`,
    }
  }

  // Window expired — delete stale record and allow
  const windowStart = new Date(now.getTime() - WINDOW_MS)
  if (new Date(data.first_attempt_at) < windowStart) {
    await supabase.from('rate_limits')
      .delete()
      .eq('identifier', identifier)
      .eq('attempt_type', attemptType)
    return { allowed: true, remainingAttempts: maxAttempts }
  }

  const remaining = maxAttempts - data.count
  return {
    allowed: remaining > 0,
    remainingAttempts: Math.max(0, remaining),
    message: remaining <= 0 ? 'Account temporarily locked. Try again later.' : undefined,
  }
}

async function recordFailure(
  identifier: string,
  attemptType: string,
  maxAttempts: number,
  lockDuration: number,
  now: Date,
) {
  const { data } = await supabase
    .from('rate_limits')
    .select('count, first_attempt_at')
    .eq('identifier', identifier)
    .eq('attempt_type', attemptType)
    .maybeSingle()

  const windowStart = new Date(now.getTime() - WINDOW_MS)
  const isExpired = !data || new Date(data.first_attempt_at) < windowStart
  const newCount = isExpired ? 1 : data.count + 1
  const lockedUntil = newCount >= maxAttempts
    ? new Date(now.getTime() + lockDuration).toISOString()
    : null

  await supabase.from('rate_limits').upsert(
    {
      identifier,
      attempt_type: attemptType,
      count: newCount,
      first_attempt_at: isExpired ? now.toISOString() : data.first_attempt_at,
      last_attempt_at: now.toISOString(),
      locked_until: lockedUntil,
    },
    { onConflict: 'identifier,attempt_type' },
  )
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
