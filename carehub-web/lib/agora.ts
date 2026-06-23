// djb2 hash — matches mobile app UID generation exactly
export function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return h === 0 ? 1 : h
}

export async function fetchAgoraToken(
  channelName: string,
  uid: number,
  clerkToken: string
): Promise<string> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agora-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ channelName, uid }),
    }
  )
  if (!res.ok) throw new Error(`Agora token fetch failed: ${res.status}`)
  const { token } = await res.json()
  return token as string
}
