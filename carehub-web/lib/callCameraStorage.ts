// Persists the user's chosen camera-off state per consultation
// (sessionStorage: survives a browser refresh within the tab session, clears
// when the tab closes) so it survives refresh/reconnect, which recreates the
// local camera track and would otherwise silently resume with the camera
// back on. Mirrors carehub-web/lib/callMuteStorage.ts exactly.
const keyFor = (consultationId: string) => `dawa-call-camoff-${consultationId}`

export function getPersistedCameraOff(consultationId: string | null | undefined): boolean {
  if (!consultationId || typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(keyFor(consultationId)) === '1'
  } catch {
    return false
  }
}

export function setPersistedCameraOff(consultationId: string | null | undefined, cameraOff: boolean) {
  if (!consultationId || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(keyFor(consultationId), cameraOff ? '1' : '0')
  } catch {}
}

export function clearPersistedCameraOff(consultationId: string | null | undefined) {
  if (!consultationId || typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(keyFor(consultationId))
  } catch {}
}
