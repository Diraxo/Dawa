import { StreamChat } from 'stream-chat'

// Singleton — avoids reconnecting on every render
let _client: StreamChat | null = null

export function getStreamClient(): StreamChat {
  if (!_client) {
    _client = StreamChat.getInstance(process.env.NEXT_PUBLIC_STREAM_API_KEY!)
  }
  return _client
}

export async function fetchStreamToken(clerkToken: string): Promise<string> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-stream-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
      },
    }
  )
  if (!res.ok) throw new Error('Stream token fetch failed')
  const { token } = await res.json()
  return token as string
}
