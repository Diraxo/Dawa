import { auth } from '@clerk/nextjs/server'
import { StreamChat } from 'stream-chat'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

// STREAM_API_SECRET is server-side only — never exposed to the client.
export async function POST() {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { allowed, message } = rateLimit(userId, 10)
  if (!allowed) {
    return NextResponse.json({ error: message }, { status: 429 })
  }

  const serverClient = StreamChat.getInstance(
    process.env.NEXT_PUBLIC_STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!
  )

  const token = serverClient.createToken(userId)
  return NextResponse.json({ token })
}
