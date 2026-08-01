import { supabaseAdmin } from '@/lib/supabase/server'

// Sends the doctor a real device push (Expo → FCM/APNs) when an admin
// changes their account status, so they find out even if the app is fully
// closed — previously only an in-app `notifications` row + email were sent,
// neither of which reaches a doctor who isn't actively looking at the app.
// Mirrors the pushMessage()/sendExpoPush() pattern already used by
// supabase/functions/send-appointment-notification and
// supabase/functions/handle-consultation-notification.
export async function sendDoctorStatusPush(
  userId: string,
  title: string,
  body: string,
  opts?: { screen?: string; prefColumn?: 'account' | 'earnings' },
) {
  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single()

  const pushToken = userRow?.push_token
  if (!pushToken) return

  const prefColumn = opts?.prefColumn ?? 'account'
  const { data: prefs } = await supabaseAdmin
    .from('notification_preferences')
    .select(prefColumn)
    .eq('user_id', userId)
    .maybeSingle()
  if (prefs && (prefs as any)[prefColumn] === false) return

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: pushToken,
        channelId: 'account',
        title,
        body,
        data: { screen: opts?.screen ?? 'profile' },
        sound: 'default',
        priority: 'high',
        badge: 1,
      }),
    })
  } catch {
    // Push is best-effort — the in-app notification row + email already sent.
  }
}
