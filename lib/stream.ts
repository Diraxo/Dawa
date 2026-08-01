import { Image } from 'react-native'
import { StreamChat, type Channel } from 'stream-chat'

const STREAM_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? ''
if (!STREAM_KEY) console.error('[Stream] EXPO_PUBLIC_STREAM_API_KEY is not set — chat will not work')

export const streamClient = StreamChat.getInstance(STREAM_KEY || 'missing-key')

// Watches a consultation's messaging channel, self-healing membership by
// passing `members` on first watch. `streamClient.channel()` caches one
// instance per cid, so if that first watch() 409s with Stream's "duplicate
// members" error (membership already provisioned elsewhere), simply calling
// `channel()` again returns the *same* cached instance — its `data`/`_data`
// still carry `members` from the first call, so a naive retry resends it and
// hits the identical error every time. Strip `members` off the cached
// instance directly before retrying.
export async function watchConsultationChannel(
  channelId: string,
  members: string[] | undefined,
  watchOptions?: Parameters<ReturnType<typeof streamClient.channel>['watch']>[0]
) {
  const ch = streamClient.channel('messaging', channelId, members ? { members } : undefined)
  try {
    await ch.watch(watchOptions)
  } catch (err) {
    if (!members) throw err
    if (ch.data) delete (ch.data as any).members
    if ((ch as any)._data) delete (ch as any)._data.members
    await ch.watch(watchOptions)
  }
  return ch
}

export async function createConsultationChannel(
  consultationId: string,
  patientId: string,
  doctorId: string,
  meta: {
    doctorName: string
    doctorSubtitle: string
    doctorPhotoUrl?: string | null
  }
) {
  const channel = streamClient.channel('messaging', consultationId, {
    members: [patientId, doctorId],
    ...({
      doctorId,
      doctorName: meta.doctorName,
      doctorSubtitle: meta.doctorSubtitle,
      doctorPhotoUrl: meta.doctorPhotoUrl ?? null,
      consultationStatus: 'active',
    } as object),
  })
  await channel.create()
  return channel
}

// Stream only learns a user's `image` at `connectUser()` time, which happens
// once per app session — without this, editing your photo mid-session leaves
// everyone already chatting with you seeing the old avatar until you fully
// reconnect. Best-effort: must never block a profile save.
export async function pushOwnPhotoToStream(photoUrl: string | null): Promise<void> {
  if (!streamClient.userID) return
  try {
    if (photoUrl) {
      await streamClient.partialUpdateUser({ id: streamClient.userID, set: { image: photoUrl } })
    } else {
      await streamClient.partialUpdateUser({ id: streamClient.userID, unset: ['image'] })
    }
  } catch {
    // Non-fatal — the next full reconnect will pick up the fresh DB value anyway.
  }
}

// Same rationale as pushOwnPhotoToStream, for `name` — Stream also only
// learns a user's `name` at `connectUser()` time. Without this, renaming
// your profile mid-session leaves Stream's own user object (and anything
// that reads it: the other party's message-push copy, Stream's default
// channel-member display) showing the old name until a full reconnect.
// Best-effort: must never block a profile save.
export async function pushOwnNameToStream(name: string): Promise<void> {
  if (!streamClient.userID || !name) return
  try {
    await streamClient.partialUpdateUser({ id: streamClient.userID, set: { name } })
  } catch {
    // Non-fatal — the next full reconnect will pick up the fresh DB value anyway.
  }
}

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

// Server-side full-history message search (P3-11) — the chat screens used to
// filter `channel.state.messages`, the SDK's in-memory paginated cache, so
// searching for anything older than the last-loaded page silently returned
// "No messages found" even though the message exists. `channel.search()`
// hits Stream's own search index instead, covering the whole channel.
export async function searchChannelMessages(channel: Channel, query: string, limit = 30) {
  const trimmed = query.trim()
  if (!trimmed) return []
  const res = await channel.search(trimmed, { limit } as any)
  return res.results.map((r) => r.message)
}

// Warms the native image cache so chat images render fully instead of
// streaming in progressively the moment a channel is opened.
export async function preloadImages(urls: string[], timeoutMs = 6000): Promise<void> {
  await Promise.all(
    urls.map((url) =>
      Promise.race([
        Image.prefetch(url).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    )
  )
}
