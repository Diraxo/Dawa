type BucketEntry = { count: number; resetTime: number }
const buckets = new Map<string, BucketEntry>()

// In-memory rate limiter. Resets per rolling 1-minute window per identifier.
// For multi-instance deployments, replace with @upstash/ratelimit + Redis.
export function rateLimit(
  identifier: string,
  limit = 10
): { allowed: boolean; message?: string } {
  const now = Date.now()
  const windowMs = 60_000

  const entry = buckets.get(identifier)

  if (!entry || now > entry.resetTime) {
    buckets.set(identifier, { count: 1, resetTime: now + windowMs })
    return { allowed: true }
  }

  if (entry.count >= limit) {
    return { allowed: false, message: 'Too many requests. Please wait a moment.' }
  }

  entry.count++
  return { allowed: true }
}
