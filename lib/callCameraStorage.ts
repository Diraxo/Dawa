import AsyncStorage from '@react-native-async-storage/async-storage'

// Persists the user's chosen camera-off state per consultation so it
// survives app restart, backgrounding, and Agora reconnect/retry (which
// recreates the engine and would otherwise silently resume with the camera
// back on). Mirrors lib/callMuteStorage.ts exactly.
const keyFor = (consultationId: string) => `dawa-call-camoff-${consultationId}`

export async function getPersistedCameraOff(consultationId: string | null | undefined): Promise<boolean> {
  if (!consultationId) return false
  try {
    const v = await AsyncStorage.getItem(keyFor(consultationId))
    return v === '1'
  } catch {
    return false
  }
}

export function setPersistedCameraOff(consultationId: string | null | undefined, cameraOff: boolean) {
  if (!consultationId) return
  AsyncStorage.setItem(keyFor(consultationId), cameraOff ? '1' : '0').catch(() => {})
}

export function clearPersistedCameraOff(consultationId: string | null | undefined) {
  if (!consultationId) return
  AsyncStorage.removeItem(keyFor(consultationId)).catch(() => {})
}
