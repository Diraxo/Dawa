// Persists the user's chosen mute state per consultation (sessionStorage:
// survives a browser refresh within the tab session, clears when the tab
// closes) so it survives refresh/reconnect, which recreates the local
// audio track and would otherwise silently resume unmuted.
const keyFor = (consultationId: string) => `dawa-call-muted-${consultationId}`

export function getPersistedMute(consultationId: string | null | undefined): boolean {
  if (!consultationId || typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(keyFor(consultationId)) === '1'
  } catch {
    return false
  }
}

export function setPersistedMute(consultationId: string | null | undefined, muted: boolean) {
  if (!consultationId || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(keyFor(consultationId), muted ? '1' : '0')
  } catch {}
}

export function clearPersistedMute(consultationId: string | null | undefined) {
  if (!consultationId || typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(keyFor(consultationId))
  } catch {}
}
