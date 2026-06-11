import {
  ChannelProfileType,
  createAgoraRtcEngine,
  IRtcEngine,
} from 'react-native-agora'

let _engine: IRtcEngine | null = null

export function getAgoraEngine(): IRtcEngine {
  if (_engine) return _engine

  const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID ?? ''
  if (!appId) throw new Error('[Agora] EXPO_PUBLIC_AGORA_APP_ID is not set')

  _engine = createAgoraRtcEngine()
  _engine.initialize({
    appId,
    channelProfile: ChannelProfileType.ChannelProfileCommunication,
  })
  return _engine
}

export function releaseAgoraEngine() {
  if (_engine) {
    _engine.release()
    _engine = null
  }
}

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

// djb2 hash → stable uint32 UID for Agora (range 1–999999)
export function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return (h % 999998) + 1
}
