import { Image } from 'react-native'
import { StreamChat } from 'stream-chat'

const STREAM_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? ''
if (!STREAM_KEY) console.error('[Stream] EXPO_PUBLIC_STREAM_API_KEY is not set — chat will not work')

export const streamClient = StreamChat.getInstance(STREAM_KEY || 'missing-key')

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
