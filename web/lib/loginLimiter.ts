// Server-side login rate limiter for Next.js API routes.
// Reads/writes directly to the Supabase rate_limits table using the service role key.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_LOCK_DURATION = 30 * 60 * 1000

export const adminLoginLimiter = {
  MAX_ATTEMPTS: 3,
  LOCK_DURATION: 60 * 60 * 1000,
}

type LimitResult = {
  allowed: boolean
  remainingAttempts?: number
  lockedUntil?: Date
  message?: string
}

export const loginLimiter = {
  check: async (
    identifier: string,
    options?: { maxAttempts?: number; lockDuration?: number },
  ): Promise<LimitResult> => {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const now = new Date()

    const { data } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('identifier', identifier)
      .eq('attempt_type', 'login')
      .maybeSingle()

    if (!data) return { allowed: true, remainingAttempts: maxAttempts }

    if (data.locked_until && new Date(data.locked_until) > now) {
      const msLeft = new Date(data.locked_until).getTime() - now.getTime()
      const minutesLeft = Math.ceil(msLeft / 60000)
      return {
        allowed: false,
        lockedUntil: new Date(data.locked_until),
        message: `Too many failed attempts. Try again in ${minutesLeft} minutes.`,
      }
    }

    const windowStart = new Date(now.getTime() - WINDOW_MS)
    if (new Date(data.first_attempt_at) < windowStart) {
      await supabase.from('rate_limits').delete().eq('identifier', identifier).eq('attempt_type', 'login')
      return { allowed: true, remainingAttempts: maxAttempts }
    }

    const remaining = maxAttempts - data.count
    return {
      allowed: remaining > 0,
      remainingAttempts: Math.max(0, remaining),
      message: remaining <= 0 ? 'Account temporarily locked. Try again later.' : undefined,
    }
  },

  recordFailure: async (
    identifier: string,
    options?: { maxAttempts?: number; lockDuration?: number },
  ): Promise<LimitResult> => {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const lockDuration = options?.lockDuration ?? DEFAULT_LOCK_DURATION
    const now = new Date()

    const { data } = await supabase
      .from('rate_limits')
      .select('count, first_attempt_at')
      .eq('identifier', identifier)
      .eq('attempt_type', 'login')
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
        attempt_type: 'login',
        count: newCount,
        first_attempt_at: isExpired ? now.toISOString() : data.first_attempt_at,
        last_attempt_at: now.toISOString(),
        locked_until: lockedUntil,
      },
      { onConflict: 'identifier,attempt_type' },
    )

    const remaining = maxAttempts - newCount
    return {
      allowed: remaining > 0,
      remainingAttempts: Math.max(0, remaining),
      lockedUntil: lockedUntil ? new Date(lockedUntil) : undefined,
      message: lockedUntil ? 'Account temporarily locked. Try again later.' : undefined,
    }
  },

  recordSuccess: async (identifier: string): Promise<void> => {
    await supabase.from('rate_limits').delete().eq('identifier', identifier).eq('attempt_type', 'login')
  },
}
