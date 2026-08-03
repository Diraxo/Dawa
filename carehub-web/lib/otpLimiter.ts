// 3 OTP requests per 15-minute window; locked for 15 minutes after that.
// State lives server-side via the Supabase rate-limit edge function —
// same as the mobile app's lib/otpLimiter.ts, just using NEXT_PUBLIC_ env vars.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const OTP_OPTIONS = { maxAttempts: 3, lockDuration: 15 * 60 * 1000 }

type OtpCheckResult = {
  allowed: boolean
  waitSeconds?: number
  message?: string
}

async function call(operation: string, email: string): Promise<OtpCheckResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rate-limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        operation,
        identifier: email.toLowerCase(),
        attempt_type: 'otp',
        options: OTP_OPTIONS,
      }),
    })
    const data = await res.json()
    if (!data.allowed && data.lockedUntil) {
      const waitSeconds = Math.ceil(
        (new Date(data.lockedUntil).getTime() - Date.now()) / 1000,
      )
      return { allowed: false, waitSeconds, message: data.message }
    }
    return data
  } catch {
    return { allowed: true }
  }
}

export const otpLimiter = {
  canRequest: (email: string) => call('check', email),
  recordRequest: (email: string) => call('record_failure', email),
}
