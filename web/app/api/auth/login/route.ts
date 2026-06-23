import { NextResponse } from 'next/server'

import { loginLimiter } from '@/lib/loginLimiter'

const BLOCKED_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'spam4.me', 'trashmail.com',
]

export async function POST(request: Request) {
  // Artificial delay on every response to prevent timing attacks
  await new Promise((r) => setTimeout(r, 500))

  const body = await request.json().catch(() => null)
  if (!body?.email) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 })
  }

  const identifier = (body.email as string).toLowerCase().trim()

  // Block disposable email domains
  const domain = identifier.split('@')[1] ?? ''
  if (BLOCKED_DOMAINS.includes(domain)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }

  const limitCheck = loginLimiter.check(identifier)
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message }, { status: 429 })
  }

  try {
    // TODO: wire Clerk server-side sign-in here when web project is set up
    // const { sessionToken } = await clerkClient.signInWithPassword({ identifier, password: body.password })
    loginLimiter.recordSuccess(identifier)
    return NextResponse.json({ success: true })
  } catch {
    loginLimiter.recordFailure(identifier)
    const check = loginLimiter.check(identifier)
    return NextResponse.json(
      { error: 'Invalid email or password.', remainingAttempts: check.remainingAttempts },
      { status: 401 }
    )
  }
}
