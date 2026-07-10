import AsyncStorage from '@react-native-async-storage/async-storage'

// Persists the user's chosen mute state per consultation so it survives
// app restart, backgrounding, and Agora reconnect/retry (which recreates
// the engine and would otherwise silently resume unmuted).
const keyFor = (consultationId: string) => `dawa-call-muted-${consultationId}`

export async function getPersistedMute(consultationId: string | null | undefined): Promise<boolean> {
  if (!consultationId) return false
  try {
    const v = await AsyncStorage.getItem(keyFor(consultationId))
    return v === '1'
  } catch {
    return false
  }
}

export function setPersistedMute(consultationId: string | null | undefined, muted: boolean) {
  if (!consultationId) return
  AsyncStorage.setItem(keyFor(consultationId), muted ? '1' : '0').catch(() => {})
}

export function clearPersistedMute(consultationId: string | null | undefined) {
  if (!consultationId) return
  AsyncStorage.removeItem(keyFor(consultationId)).catch(() => {})
}
