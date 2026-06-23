import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WINDOW_MS = 15 * 60 * 1000
const MAX_OTP_REQUESTS = 3
const OTP_LOCK_DURATION = 15 * 60 * 1000
const MIN_RESEND_INTERVAL = 60 * 1000

type OtpCheckResult = {
  allowed: boolean
  waitSeconds?: number
  message?: string
}

export const otpLimiter = {
  canRequest: async (email: string): Promise<OtpCheckResult> => {
    const now = new Date()
    const key = email.toLowerCase()

    const { data } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('identifier', key)
      .eq('attempt_type', 'otp')
      .maybeSingle()

    if (!data) return { allowed: true }

    // Minimum resend interval
    const timeSinceLast = now.getTime() - new Date(data.last_attempt_at).getTime()
    if (timeSinceLast < MIN_RESEND_INTERVAL) {
      const waitSeconds = Math.ceil((MIN_RESEND_INTERVAL - timeSinceLast) / 1000)
      return {
        allowed: false,
        waitSeconds,
        message: `Please wait ${waitSeconds} seconds before requesting another code.`,
      }
    }

    // Still locked from hitting the per-window cap?
    if (data.locked_until && new Date(data.locked_until) > now) {
      const waitSeconds = Math.ceil((new Date(data.locked_until).getTime() - now.getTime()) / 1000)
      return {
        allowed: false,
        waitSeconds,
        message: 'Too many code requests. Please try again in 15 minutes.',
      }
    }

    // Window expired — allow fresh start
    const windowStart = new Date(now.getTime() - WINDOW_MS)
    if (new Date(data.first_attempt_at) < windowStart) return { allowed: true }

    if (data.count >= MAX_OTP_REQUESTS) {
      return {
        allowed: false,
        message: 'Too many code requests. Please try again in 15 minutes.',
      }
    }

    return { allowed: true }
  },

  recordRequest: async (email: string): Promise<void> => {
    const now = new Date()
    const key = email.toLowerCase()

    const { data } = await supabase
      .from('rate_limits')
      .select('count, first_attempt_at')
      .eq('identifier', key)
      .eq('attempt_type', 'otp')
      .maybeSingle()

    const windowStart = new Date(now.getTime() - WINDOW_MS)
    const isExpired = !data || new Date(data.first_attempt_at) < windowStart
    const newCount = isExpired ? 1 : data.count + 1
    const lockedUntil = newCount >= MAX_OTP_REQUESTS
      ? new Date(now.getTime() + OTP_LOCK_DURATION).toISOString()
      : null

    await supabase.from('rate_limits').upsert(
      {
        identifier: key,
        attempt_type: 'otp',
        count: newCount,
        first_attempt_at: isExpired ? now.toISOString() : data.first_attempt_at,
        last_attempt_at: now.toISOString(),
        locked_until: lockedUntil,
      },
      { onConflict: 'identifier,attempt_type' },
    )
  },
}
