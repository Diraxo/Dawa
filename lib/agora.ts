// Pre-load react-native-agora at module level so any TurboModule crash is caught
// here rather than propagating uncaught during Expo Router's route-tree build.
// In Expo Go or unlinked builds the native side isn't registered; _rna stays null
// and getAgoraEngine() throws a clear error instead of crashing at startup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let _rna: any = null
try { _rna = require('react-native-agora') } catch {}

let _engine: any = null

export function getAgoraEngine(): any {
  if (_engine) return _engine
  if (!_rna) {
    throw new Error(
      '[Agora] react-native-agora is not linked — use a development build, not Expo Go'
    )
  }

  const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID ?? ''
  if (!appId) throw new Error('[Agora] EXPO_PUBLIC_AGORA_APP_ID is not set')

  const { createAgoraRtcEngine, ChannelProfileType } = _rna
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

// djb2 hash → stable uint32 UID for Agora (full uint32 range avoids collisions)
export function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  // Ensure non-zero (Agora treats 0 as "any user")
  return h === 0 ? 1 : h
}
