import { StreamChat } from 'stream-chat'

// Extracts image attachment URLs from a batch of Stream messages, deduped.
export function getMessageImageUrls(messages: { attachments?: any[] }[]): string[] {
  const urls = new Set<string>()
  for (const m of messages) {
    for (const att of m.attachments ?? []) {
      if (att.type === 'image' || att.image_url) {
        const src = att.image_url ?? att.asset_url
        if (src) urls.add(src)
      }
    }
  }
  return Array.from(urls)
}

// Warms the browser image cache so chat images render fully instead of
// streaming in progressively the moment a channel is opened.
export function preloadImages(urls: string[], timeoutMs = 6000): Promise<void[]> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new window.Image()
          const timer = setTimeout(resolve, timeoutMs)
          img.onload = () => {
            clearTimeout(timer)
            resolve()
          }
          img.onerror = () => {
            clearTimeout(timer)
            resolve()
          }
          img.src = url
        })
    )
  )
}

// Singleton — avoids reconnecting on every render
let _client: StreamChat | null = null

export function getStreamClient(): StreamChat {
  if (!_client) {
    _client = StreamChat.getInstance(process.env.NEXT_PUBLIC_STREAM_API_KEY!)
  }
  return _client
}

// The client's socket can drop silently (tab backgrounded, network blip)
// with nothing in the UI aware of it, so a currently-open channel/list stops
// getting live events until the page is reloaded. Callers subscribe here to
// resync (re-`watch()`, re-`queryChannels()`) whenever the connection comes
// back.
export function onStreamReconnect(cb: () => void): () => void {
  const sub = getStreamClient().on('connection.changed', (event) => {
    if (event.online) cb()
  })
  return () => sub.unsubscribe()
}

// Stream only learns a user's `image` at `connectUser()` time, which happens
// once per browser session (guarded by `if (!client.userID)` at every call
// site) — without this, editing your photo mid-session leaves everyone
// already chatting with you seeing the old avatar until they reload.
// Best-effort: must never block a profile save.
export async function pushOwnPhotoToStream(photoUrl: string | null): Promise<void> {
  const client = getStreamClient()
  if (!client.userID) return
  try {
    if (photoUrl) {
      await client.partialUpdateUser({ id: client.userID, set: { image: photoUrl } })
    } else {
      await client.partialUpdateUser({ id: client.userID, unset: ['image'] })
    }
  } catch {
    // Non-fatal — the next full reconnect will pick up the fresh DB value anyway.
  }
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
