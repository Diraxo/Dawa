// All OTP rate-limit state lives in Supabase via the rate-limit edge function.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// 3 OTP requests per 15-minute window; locked for 15 minutes after that
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

    // Map lockedUntil → waitSeconds for the UI countdown
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
