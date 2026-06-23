import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

import { loginLimiter, adminLoginLimiter } from '@/lib/loginLimiter'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY)

const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? 'abdirahmanug7@gmail.com'

async function logEvent(
  adminId: string | null,
  action: string,
  ip: string,
  userAgent: string,
  metadata?: Record<string, unknown>
) {
  await supabaseAdmin.from('admin_logs').insert({
    admin_id: adminId,
    action,
    ip,
    user_agent: userAgent,
    metadata: metadata ?? null,
  })
}

async function sendFailureAlert(email: string, ip: string, userAgent: string, attempt: number) {
  await resend.emails.send({
    from: 'Dawa Security <security@dawa.app>',
    to: ALERT_EMAIL,
    subject: `[ALERT] Failed admin login attempt #${attempt}`,
    html: `
      <h2>Failed Admin Login Attempt</h2>
      <p>Someone tried to log in to the Dawa admin panel and failed.</p>
      <table>
        <tr><td><strong>Email tried:</strong></td><td>${email}</td></tr>
        <tr><td><strong>IP address:</strong></td><td>${ip}</td></tr>
        <tr><td><strong>Browser:</strong></td><td>${userAgent}</td></tr>
        <tr><td><strong>Attempt #:</strong></td><td>${attempt}</td></tr>
        <tr><td><strong>Time:</strong></td><td>${new Date().toUTCString()}</td></tr>
      </table>
      <p>If this was not you, your admin account may be under attack.</p>
    `,
  })
}

export async function POST(request: Request) {
  // Artificial delay on every response to prevent timing attacks
  await new Promise((r) => setTimeout(r, 500))

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = request.headers.get('user-agent') ?? 'unknown'

  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 })
  }

  // Honeypot check — bots fill hidden fields
  if (body.website) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const identifier = (body.email as string).toLowerCase().trim()

  // Stricter rate limiting for admin: 3 attempts, 60 min lockout
  const limitCheck = loginLimiter.check(identifier, {
    maxAttempts: adminLoginLimiter.MAX_ATTEMPTS,
    lockDuration: adminLoginLimiter.LOCK_DURATION,
  })

  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message }, { status: 429 })
  }

  try {
    // Verify credentials via Supabase auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email: identifier,
      password: body.password,
    })

    if (authError || !authData.user) {
      loginLimiter.recordFailure(identifier, {
        maxAttempts: adminLoginLimiter.MAX_ATTEMPTS,
        lockDuration: adminLoginLimiter.LOCK_DURATION,
      })

      const check = loginLimiter.check(identifier, {
        maxAttempts: adminLoginLimiter.MAX_ATTEMPTS,
        lockDuration: adminLoginLimiter.LOCK_DURATION,
      })

      // Log failed attempt and send alert email
      await logEvent(null, 'login_failed', ip, userAgent, { email: identifier, attempt: adminLoginLimiter.MAX_ATTEMPTS - (check.remainingAttempts ?? 0) })
      await sendFailureAlert(identifier, ip, userAgent, adminLoginLimiter.MAX_ATTEMPTS - (check.remainingAttempts ?? 0)).catch(() => {})

      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }

    // Confirm the user is actually an admin
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('email', identifier)
      .single()

    if (userRow?.role !== 'admin') {
      // Not an admin — treat as failed login and alert
      loginLimiter.recordFailure(identifier, {
        maxAttempts: adminLoginLimiter.MAX_ATTEMPTS,
        lockDuration: adminLoginLimiter.LOCK_DURATION,
      })
      await logEvent(null, 'login_failed_not_admin', ip, userAgent, { email: identifier })
      await sendFailureAlert(identifier, ip, userAgent, 1).catch(() => {})
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }

    // Success
    loginLimiter.recordSuccess(identifier)
    await logEvent(userRow.id, 'login', ip, userAgent)

    return NextResponse.json({
      success: true,
      token: authData.session?.access_token,
    })
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
