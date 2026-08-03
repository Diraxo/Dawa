// Client-side helpers for real (not hardcoded) badge counts and read-state
// sync, shared by the notification tap handler (app/_layout.tsx), the
// Notification Center screen, and every "auto-clear on direct navigation"
// call site (waiting room, chat, summary, consultation details).
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

export interface NotificationRow {
  id: string
  user_id: string
  title: string
  body: string
  type: string | null
  data_json: Record<string, any> | null
  read_at: string | null
  created_at: string | null
}

export const NOTIFICATIONS_PAGE_SIZE = 20

export async function getUnreadCount(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 0
}

// The single source of truth for the OS badge — call after any action that
// could change the unread count (mark-read, mark-all-read, auto-clear, app
// foreground) so the badge always reflects real state instead of drifting.
export async function refreshBadge(client: SupabaseClient, userId: string | null | undefined): Promise<void> {
  if (!userId || Platform.OS === 'web') return
  try {
    const count = await getUnreadCount(client, userId)
    await Notifications.setBadgeCountAsync(count)
  } catch (e) {
    logger.warn('[notificationCenter] refreshBadge failed:', e)
  }
}

export async function fetchNotificationsPage(
  client: SupabaseClient,
  userId: string,
  page: number,
): Promise<NotificationRow[]> {
  const from = page * NOTIFICATIONS_PAGE_SIZE
  const to = from + NOTIFICATIONS_PAGE_SIZE - 1
  const { data, error } = await client
    .from('notifications')
    .select('id, user_id, title, body, type, data_json, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) {
    logger.warn('[notificationCenter] fetchNotificationsPage failed:', error.message)
    return []
  }
  return (data as any) ?? []
}

export async function markNotificationRead(client: SupabaseClient, id: string): Promise<void> {
  await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
}

export async function markAllRead(client: SupabaseClient, userId: string): Promise<void> {
  await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)
}

// Auto-clear (spec section 11): when a user reaches a destination screen by
// navigating there directly — not by tapping the notification — the
// notification(s) that would have led them there must be recognized as
// handled: read_at set, removed from the unread badge. Matches on
// consultationId inside data_json rather than a specific notification id
// since the user never tapped a specific one.
export async function markNotificationsReadForConsultation(
  client: SupabaseClient,
  userId: string | null | undefined,
  consultationId: string | null | undefined,
): Promise<void> {
  if (!userId || !consultationId) return
  try {
    await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
      .contains('data_json', { consultationId })
    await refreshBadge(client, userId)
  } catch (e) {
    logger.warn('[notificationCenter] markNotificationsReadForConsultation failed:', e)
  }
}
