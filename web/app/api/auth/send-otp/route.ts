import { NextResponse } from 'next/server'

import { otpLimiter } from '@/lib/otpLimiter'

const BLOCKED_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'spam4.me', 'trashmail.com',
]

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.email) {
    return NextResponse.json({ error: 'Please use a valid email address.' }, { status: 400 })
  }

  const email = (body.email as string).toLowerCase().trim()

  const domain = email.split('@')[1] ?? ''
  if (BLOCKED_DOMAINS.includes(domain)) {
    return NextResponse.json({ error: 'Please use a valid email address.' }, { status: 400 })
  }

  const check = otpLimiter.canRequest(email)
  if (!check.allowed) {
    return NextResponse.json(
      { error: check.message, waitSeconds: check.waitSeconds ?? null },
      { status: 429 }
    )
  }

  try {
    // TODO: trigger Clerk OTP send when web project is set up
    // await clerkClient.emailAddresses.createEmailAddress({ ... })
    otpLimiter.recordRequest(email)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
