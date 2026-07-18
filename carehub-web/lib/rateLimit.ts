/**
 * In-memory rate limiter with exponential backoff and temporary lockouts.
 * For multi-instance production deployments, swap the bucket store for
 * @upstash/ratelimit + Redis — the interface is intentionally compatible.
 *
 * Limits by default:
 *   - consultation booking:  5 / 10 min
 *   - payment initiation:    3 / 10 min
 *   - file uploads:         10 / 10 min
 *   - stream-token / chat:  30 / 1 min
 *   - OTP / password reset:  3 / 15 min  (handled by the Supabase edge function)
 */

interface Bucket {
  count:     number
  resetTime: number
  lockUntil: number | null
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed:          boolean
  remaining:        number
  resetInSeconds:   number
  retryAfterSeconds?: number
  message?:         string
}

export interface RateLimitOptions {
  /** Max requests allowed in the window. Default 10. */
  limit?:         number
  /** Window length in milliseconds. Default 60_000 (1 min). */
  windowMs?:      number
  /** Lockout duration (ms) once limit is exceeded. Default 5 × windowMs. */
  lockDurationMs?: number
  /** Human-friendly label for the error message. Default 'requests'. */
  label?:         string
}

export function rateLimit(
  identifier: string,
  options: RateLimitOptions = {},
): RateLimitResult {
  const {
    limit        = 10,
    windowMs     = 60_000,
    lockDurationMs = windowMs * 5,
    label        = 'requests',
  } = options

  const now = Date.now()
  const entry = buckets.get(identifier)

  // Check active lockout
  if (entry?.lockUntil && now < entry.lockUntil) {
    const retryAfterSeconds = Math.ceil((entry.lockUntil - now) / 1000)
    const mins = Math.ceil(retryAfterSeconds / 60)
    return {
      allowed:            false,
      remaining:          0,
      resetInSeconds:     retryAfterSeconds,
      retryAfterSeconds,
      message:            `Too many ${label}. Try again in ${mins > 1 ? `${mins} minutes` : '1 minute'}.`,
    }
  }

  // Window expired or no entry — fresh start
  if (!entry || now > entry.resetTime) {
    buckets.set(identifier, { count: 1, resetTime: now + windowMs, lockUntil: null })
    return { allowed: true, remaining: limit - 1, resetInSeconds: Math.ceil(windowMs / 1000) }
  }

  if (entry.count >= limit) {
    // Apply lockout and return blocked result
    entry.lockUntil = now + lockDurationMs
    const retryAfterSeconds = Math.ceil(lockDurationMs / 1000)
    const mins = Math.ceil(retryAfterSeconds / 60)
    return {
      allowed:            false,
      remaining:          0,
      resetInSeconds:     retryAfterSeconds,
      retryAfterSeconds,
      message:            `Too many ${label}. Try again in ${mins > 1 ? `${mins} minutes` : '1 minute'}.`,
    }
  }

  entry.count++
  const remaining = limit - entry.count
  return {
    allowed:        true,
    remaining,
    resetInSeconds: Math.ceil((entry.resetTime - now) / 1000),
  }
}

/** Preset configs for each protected route type. */
export const LIMITS = {
  consultationBooking: { limit: 5,  windowMs: 10 * 60_000, lockDurationMs: 30 * 60_000, label: 'booking attempts' },
  paymentInitiation:   { limit: 3,  windowMs: 10 * 60_000, lockDurationMs: 30 * 60_000, label: 'payment attempts' },
  fileUpload:          { limit: 10, windowMs: 10 * 60_000, lockDurationMs: 15 * 60_000, label: 'file uploads' },
  streamToken:         { limit: 30, windowMs: 60_000,       lockDurationMs:  5 * 60_000, label: 'token requests' },
  chatFileProxy:       { limit: 60, windowMs: 60_000,       lockDurationMs:  5 * 60_000, label: 'document requests' },
  agoraToken:          { limit: 20, windowMs: 60_000,       lockDurationMs:  5 * 60_000, label: 'token requests' },
  supportRequest:      { limit: 3,  windowMs: 60 * 60_000, lockDurationMs: 60 * 60_000, label: 'support requests' },
} as const

/** Extract a stable rate-limit identifier from a request (IP + optional suffix). */
export function getRateLimitId(req: Request, suffix?: string): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  return suffix ? `${ip}:${suffix}` : ip
}

/** Return a 429 Response pre-formatted. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: result.message ?? 'Too many requests. Please slow down.' }),
    {
      status:  429,
      headers: {
        'Content-Type':      'application/json',
        'Retry-After':       String(result.retryAfterSeconds ?? 60),
        'X-RateLimit-Limit': '0',
        'X-RateLimit-Reset': String(Date.now() + (result.resetInSeconds ?? 60) * 1000),
      },
    },
  )
}
