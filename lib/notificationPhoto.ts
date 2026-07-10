import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'

// iOS-only, best-effort: a UNNotificationAttachment requires a local file://
// URI, not a remote URL, so the counterpart's photo must be downloaded to
// cache before it can be attached to a local notification. Android's
// expo-notifications has no equivalent local-notification image API without
// a custom dev-client module, so this intentionally no-ops there. Never
// throws and never blocks scheduling a notification — a slow/failed
// download just means the notification ships without a photo.
export async function localizeNotificationPhoto(photoUrl: string | null | undefined): Promise<string | null> {
  if (Platform.OS !== 'ios' || !photoUrl) return null
  try {
    const file = await Promise.race([
      File.downloadFileAsync(photoUrl, Paths.cache),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ])
    return file.uri
  } catch {
    return null
  }
}
