// djb2 hash — matches mobile app UID generation exactly
export function uidFromString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0
  }
  return h === 0 ? 1 : h
}

export interface AgoraTokenResult {
  token: string
  /** Unix timestamp in SECONDS when the token privilege expires */
  expiresAt: number
}

export interface MediaErrorClassification {
  /** The DOMException.name from the failed getUserMedia() call, or 'unknown'. */
  name: string
  /** True only for errors that mean the user/browser genuinely blocked the
   * permission (NotAllowedError, PermissionDeniedError, SecurityError).
   * Everything else — NotReadableError (device held by another app/tab),
   * AbortError, NotFoundError (no device), OverconstrainedError — is NOT a
   * permission denial and must never be shown as "access denied", since
   * that sends users to the wrong fix (site settings) instead of the real
   * one (close the other app/tab, plug in a device, etc). */
  genuinelyDenied: boolean
}

export function classifyMediaError(err: unknown): MediaErrorClassification {
  const name = err instanceof Error ? err.name : ''
  const genuinelyDenied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError'
  return { name: name || 'unknown', genuinelyDenied }
}

// Tracks in-flight client.leave() calls per channel so a rejoin (whether
// triggered by a component remount, a Retry button, or React effect churn)
// always waits for the previous session to fully leave first. Without this,
// a new client.join() can race an old leave() still in flight on Agora's
// servers, which the SDK reports back as UID_CONFLICT.
const pendingLeaves = new Map<string, Promise<void>>()

export function trackAgoraLeave(channelId: string, leaving: Promise<void>): void {
  const tracked = leaving.catch(() => {}).finally(() => {
    if (pendingLeaves.get(channelId) === tracked) pendingLeaves.delete(channelId)
  })
  pendingLeaves.set(channelId, tracked)
}

export async function waitForPendingAgoraLeave(channelId: string): Promise<void> {
  await pendingLeaves.get(channelId)
}

export async function fetchAgoraToken(
  channelName: string,
  uid: number,
  clerkToken: string
): Promise<AgoraTokenResult> {
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
  const data = await res.json()
  return {
    token: data.token as string,
    // Edge function always returns expiresAt; fall back to +1 hour for older deploys
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : Math.floor(Date.now() / 1000) + 3600,
  }
}
