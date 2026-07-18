import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  fetchNotificationsPage,
  getUnreadCount,
  markAllRead as markAllReadApi,
  markNotificationRead as markNotificationReadApi,
  refreshBadge,
  NotificationRow,
  NOTIFICATIONS_PAGE_SIZE,
} from '@/lib/notificationCenter'

// Backs the Notification Center screen: paginated list, pull-to-refresh,
// live updates (new notifications insert at the top without a manual
// refresh), mark-as-read / mark-all-read, and the badge count that drives
// the doctor Home bell + profile menu row. One hook, shared by both role
// screens (components/notifications/NotificationCenterView.tsx).
export function useNotificationCenter(userId: string | null | undefined) {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const pageRef = useRef(0)

  const loadFirstPage = useCallback(async () => {
    if (!userId) return
    pageRef.current = 0
    const [page, count] = await Promise.all([
      fetchNotificationsPage(supabase, userId, 0),
      getUnreadCount(supabase, userId),
    ])
    setItems(page)
    setUnreadCount(count)
    setHasMore(page.length === NOTIFICATIONS_PAGE_SIZE)
  }, [userId])

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    loadFirstPage().finally(() => setLoading(false))
  }, [userId, loadFirstPage])

  // Realtime: a push notification arriving while this screen is open should
  // appear immediately, and another device marking something read should
  // reflect here too.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`notification-center-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems((prev) => [payload.new as NotificationRow, ...prev])
          setUnreadCount((c) => c + 1)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as NotificationRow
          setItems((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const refresh = useCallback(async () => {
    if (!userId) return
    setRefreshing(true)
    try {
      await loadFirstPage()
    } finally {
      setRefreshing(false)
    }
  }, [userId, loadFirstPage])

  const loadMore = useCallback(async () => {
    if (!userId || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = pageRef.current + 1
      const page = await fetchNotificationsPage(supabase, userId, nextPage)
      pageRef.current = nextPage
      setItems((prev) => [...prev, ...page])
      setHasMore(page.length === NOTIFICATIONS_PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [userId, loadingMore, hasMore])

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at) ? { ...n, read_at: new Date().toISOString() } : n))
    setUnreadCount((c) => Math.max(0, c - 1))
    await markNotificationReadApi(supabase, id)
    await refreshBadge(supabase, userId)
  }, [userId])

  const markAllRead = useCallback(async () => {
    if (!userId) return
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    setUnreadCount(0)
    await markAllReadApi(supabase, userId)
    await refreshBadge(supabase, userId)
  }, [userId])

  return { items, unreadCount, loading, refreshing, loadingMore, hasMore, refresh, loadMore, markRead, markAllRead }
}
