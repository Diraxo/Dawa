import { Ionicons } from '@expo/vector-icons'
import { useUser } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { formatRelativeTime } from '@/lib/dateFormat'
import { navigateForNotification } from '@/lib/notificationNav'
import { supabase } from '@/lib/supabase'
import { useNotificationCenter } from '@/hooks/useNotificationCenter'
import type { NotificationRow } from '@/lib/notificationCenter'

const TYPE_META: Record<string, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  new_request:          { icon: 'medkit-outline',            color: colors.tealGreen },
  accepted:              { icon: 'videocam-outline',          color: colors.careBlue },
  declined:              { icon: 'close-circle-outline',      color: colors.error },
  cancelled:             { icon: 'close-circle-outline',      color: colors.error },
  missed_call:           { icon: 'call-outline',              color: colors.warning },
  call_declined:         { icon: 'call-outline',              color: colors.error },
  summary_ready:         { icon: 'document-text-outline',     color: '#7C3AED' },
  summary_updated:       { icon: 'document-text-outline',     color: '#7C3AED' },
  review_received:       { icon: 'star-outline',               color: '#F59E0B' },
  scheduled_booking:     { icon: 'calendar-outline',           color: colors.careBlue },
  rescheduled:           { icon: 'calendar-outline',           color: colors.careBlue },
  completed:             { icon: 'checkmark-circle-outline',   color: colors.success },
  patient_joined:        { icon: 'person-add-outline',         color: colors.tealGreen },
  patient_left:          { icon: 'person-remove-outline',      color: colors.warning },
  doctor_running_late:   { icon: 'time-outline',                color: colors.warning },
  doctor_ready:          { icon: 'checkmark-circle-outline',   color: colors.tealGreen },
  appointment_reminder:  { icon: 'calendar-outline',           color: colors.careBlue },
  appointment_start:     { icon: 'alarm-outline',               color: colors.tealGreen },
  followup_reminder:     { icon: 'refresh-outline',             color: colors.interactiveBlue },
  doctor_approved:       { icon: 'shield-checkmark-outline',   color: colors.success },
}
const DEFAULT_META = { icon: 'notifications-outline' as const, color: colors.steelGrey }

export default function NotificationCenterView({ role }: { role: 'doctor' | 'patient' }) {
  const router = useRouter()
  const { user } = useUser()
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setUserId((data as any).id)
    })
    return () => { cancelled = true }
  }, [user?.id])

  const { items, unreadCount, loading, refreshing, loadingMore, hasMore, refresh, loadMore, markRead, markAllRead } =
    useNotificationCenter(userId)

  const onPressItem = async (item: NotificationRow) => {
    if (!item.read_at) await markRead(item.id)
    navigateForNotification(router, role, item.data_json ?? {})
  }

  const renderItem = ({ item }: { item: NotificationRow }) => {
    const meta = TYPE_META[item.type ?? ''] ?? DEFAULT_META
    const unread = !item.read_at
    return (
      <Pressable
        onPress={() => onPressItem(item)}
        style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: `${meta.color}18` }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
        </View>
        {unread && <View style={styles.dot} />}
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Pressable
          onPress={markAllRead}
          disabled={unreadCount === 0}
          hitSlop={10}
          style={({ pressed }) => [styles.markAllBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.markAllText, unreadCount === 0 && styles.markAllTextDisabled]}>Mark all read</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.tealGreen} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="notifications-off-outline" size={40} color={colors.steelGrey} />
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.tealGreen} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.tealGreen} /> : null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  markAllBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 90, alignItems: 'flex-end' },
  markAllText: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.tealGreen },
  markAllTextDisabled: { color: colors.steelGrey },

  listContent: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  rowUnread: { borderWidth: 1, borderColor: `${colors.tealGreen}33` },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  title: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  titleUnread: { fontFamily: fonts.bold },
  body: { fontFamily: fonts.regular, fontSize: 12.5, color: '#6B7280', lineHeight: 18 },
  time: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealGreen, marginTop: 6 },
})
