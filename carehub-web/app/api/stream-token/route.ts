import { auth } from '@clerk/nextjs/server'
import { StreamChat } from 'stream-chat'
import { NextResponse } from 'next/server'
import { rateLimit, LIMITS, getRateLimitId, tooManyRequests } from '@/lib/rateLimit'

// STREAM_API_SECRET is server-side only — never exposed to the client.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(`stream-token:${userId}`, LIMITS.streamToken)
  if (!rl.allowed) return tooManyRequests(rl)

  const serverClient = StreamChat.getInstance(
    process.env.NEXT_PUBLIC_STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!
  )

  const token = serverClient.createToken(userId)
  return NextResponse.json({ token })
}
