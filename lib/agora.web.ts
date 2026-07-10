// Web stub — react-native-agora is native-only.
// fetchAgoraToken and uidFromString are pure JS and duplicated here.
// getAgoraEngine / releaseAgoraEngine are no-ops on web.

export function getAgoraEngine(): never {
  throw new Error('Agora RTC is not supported on web')
}

export function releaseAgoraEngine() {}

export async function fetchAgoraToken(
  channelName: string,
  uid: number,
  clerkToken: string
): Promise<string> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const res = await fetch(`${supabaseUrl}/functions/v1/agora-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify({ channelName, uid }),
  })
  if (!res.ok) throw new Error(`Agora token fetch failed: ${res.status}`)
  const { token } = await res.json()
  return token as string
}

// djb2 hash — must match lib/agora.ts and carehub-web/lib/agora.ts exactly
export function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return h === 0 ? 1 : h
}
