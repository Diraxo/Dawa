import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

// Proxies to the Supabase Edge Function which holds AGORA_APP_CERTIFICATE.
// The certificate is never sent to the client — only the short-lived token is.
export async function POST(request: Request) {
  const { userId, getToken } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { allowed, message } = rateLimit(userId, 10)
  if (!allowed) {
    return NextResponse.json({ error: message }, { status: 429 })
  }

  let channelName: string
  let uid: number
  try {
    const body = await request.json()
    channelName = body.channelName
    uid = Number(body.uid)
    if (!channelName || isNaN(uid)) throw new Error('invalid')
  } catch {
    return NextResponse.json(
      { error: 'channelName (string) and uid (number) are required' },
      { status: 400 }
    )
  }

  const clerkToken = await getToken()
  if (!clerkToken) {
    return NextResponse.json({ error: 'Could not retrieve session token' }, { status: 401 })
  }

  const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agora-token`
  const res = await fetch(edgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
    },
    body: JSON.stringify({ channelName, uid }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Token generation failed' }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
