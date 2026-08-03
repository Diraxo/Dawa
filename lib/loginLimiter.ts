// All rate-limit state lives in Supabase (rate_limits table) via the rate-limit edge function.
// The edge function uses the service role key, so no secrets are exposed here.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

type LimitResult = {
  allowed: boolean
  remainingAttempts?: number
  lockedUntil?: string
  message?: string
}

async function call(
  operation: string,
  identifier: string,
  options?: { maxAttempts?: number; lockDuration?: number },
): Promise<LimitResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rate-limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ operation, identifier, attempt_type: 'login', options }),
    })
    return await res.json()
  } catch {
    // Fail open — never block login if the edge function is unreachable
    return { allowed: true, remainingAttempts: 5 }
  }
}

export const loginLimiter = {
  check: (identifier: string, options?: { maxAttempts?: number; lockDuration?: number }) =>
    call('check', identifier, options),

  // Records failure and returns the updated limit state in one round-trip
  recordFailure: (identifier: string, options?: { maxAttempts?: number; lockDuration?: number }) =>
    call('record_failure', identifier, options),

  recordSuccess: (identifier: string) =>
    call('record_success', identifier),
}
