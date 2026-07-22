import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Conversation, ConversationItem } from '@/components/ui/ConversationItem'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { isChannelReadThrough, markChannelReadLocally } from '@/lib/readCache'
import { shadow } from '@/lib/shadow'
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'
import { useTranslation } from 'react-i18next'

// ─── Types ────────────────────────────────────────────────────────────────────

type ListItem = Conversation & { type: 'conv' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function attachmentPreview(attachments: readonly any[] | undefined): string | null {
  if (!attachments?.length) return null
  const att = attachments[0] as any
  if (att.type === 'image') return 'Photo'
  if (att.type === 'audio' || (att.mime_type as string | undefined)?.includes('audio')) return 'Voice message'
  if (att.type === 'video') return 'Video'
  return 'File'
}

function formatTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DoctorMessagesScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const guardNav = useNavGuard()
  const { isStreamConnected, userId } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // ── Focus effect: fetch + real-time subscriptions ─────────────────────────

  useFocusEffect(
    useCallback(() => {
      if (!isStreamConnected || !userId) return
      const cancelled = { value: false }

      const loadConversations = async () => {
        try {
          const channels = await streamClient.queryChannels(
            { type: 'messaging', members: { $in: [userId] } },
            { last_message_at: -1 },
            { watch: true, state: true, presence: true, limit: 30 }
          )
          if (cancelled.value) return

          const convos: Conversation[] = channels.map((ch) => {
            const msgs = ch.state.messages
            const lastMsg = msgs[msgs.length - 1]
            const patientMember = Object.values(ch.state.members).find(
              (m) => m.user?.id !== userId
            )
            const d = ch.data as Record<string, unknown> | undefined
            const status =
              (d?.consultationStatus as string) === 'completed' ? 'completed' : 'active'

            return {
              id: ch.id ?? '',
              peerId: patientMember?.user?.id ?? '',
              peerName: patientMember?.user?.name ?? 'Patient',
              peerSubtitle: '',
              peerPhotoUrl: (patientMember?.user?.image as string | undefined) ?? null,
              lastMessage:
                lastMsg?.text || attachmentPreview(lastMsg?.attachments) || 'No messages yet',
              lastMessageTime: formatTime(lastMsg?.created_at),
              unreadCount: isChannelReadThrough(ch.id ?? '', lastMsg?.id) ? 0 : ch.countUnread(),
              isOnline: patientMember?.user?.online ?? false,
              isPinned: !!(d as any)?.pinned,
              consultationStatus: status as 'active' | 'completed',
            }
          })
          setConversations(convos)
        } catch (err) {
          logger.error('[DoctorMessages] queryChannels error:', err)
        } finally {
          if (!cancelled.value) setLoading(false)
        }
      }

      setLoading(true)
      loadConversations()

      // In-place update when a new message arrives in a watched channel
      const sub1 = streamClient.on('message.new', (event) => {
        if (!event.message || !event.cid) return
        const channelId = event.cid.replace('messaging:', '')
        const msg = event.message
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === channelId)
          if (idx === -1) return prev
          const updated = [...prev]
          updated[idx] = {
            ...updated[idx],
            lastMessage: msg.text || attachmentPreview(msg.attachments) || 'Message',
            lastMessageTime: formatTime(msg.created_at),
            unreadCount:
              msg.user?.id === userId ? updated[idx].unreadCount : updated[idx].unreadCount + 1,
          }
          const [conv] = updated.splice(idx, 1)
          return [conv, ...updated]
        })
      })

      // Full refetch when a message arrives in a channel not yet being watched
      const sub2 = streamClient.on('notification.message_new', () => {
        if (!cancelled.value) loadConversations()
      })

      // Live online/offline dot — requires `presence: true` above to be populated.
      const sub3 = streamClient.on('user.presence.changed', (event) => {
        const presenceUserId = event.user?.id
        if (!presenceUserId) return
        setConversations((prev) =>
          prev.map((c) =>
            c.peerId === presenceUserId ? { ...c, isOnline: !!event.user?.online } : c
          )
        )
      })

      // Keep the "Completed" pill live while sitting on this tab — ending the
      // consultation flips the channel's consultationStatus field (see
      // freeze-consultation-channel edge function), but without this the row
      // wouldn't reflect it until the user navigates away and back.
      const sub4 = streamClient.on('channel.updated', (event) => {
        if (!event.cid) return
        const channelId = event.cid.replace('messaging:', '')
        const status = (event.channel as any)?.consultationStatus
        if (status !== 'completed') return
        setConversations((prev) =>
          prev.map((c) => (c.id === channelId ? { ...c, consultationStatus: 'completed' } : c))
        )
      })

      // Live avatar update — e.g. the patient changes their profile photo
      // while this list is open.
      const sub5 = streamClient.on('user.updated', (event) => {
        const updatedUserId = event.user?.id
        if (!updatedUserId) return
        setConversations((prev) =>
          prev.map((c) =>
            c.peerId === updatedUserId ? { ...c, peerPhotoUrl: (event.user as any)?.image ?? null } : c
          )
        )
      })

      return () => {
        cancelled.value = true
        sub1.unsubscribe()
        sub2.unsubscribe()
        sub3.unsubscribe()
        sub4.unsubscribe()
        sub5.unsubscribe()
      }
    }, [isStreamConnected, userId])
  )

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) => c.peerName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
    )
  }, [conversations, searchQuery])

  const listItems = useMemo<ListItem[]>(() => {
    const pinned = filtered.filter((c) => c.isPinned)
    const others = filtered.filter((c) => !c.isPinned)
    return [...pinned, ...others].map((c) => ({ type: 'conv', ...c }))
  }, [filtered])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePress = guardNav((id: string) => {
    const convo = conversations.find((c) => c.id === id)
    if (!convo) return
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    )
    try {
      const ch = Object.values(streamClient.activeChannels).find((c: any) => c.id === convo.id)
      ch?.markRead().catch(() => {})
      const msgs = (ch as any)?.state?.messages as any[] | undefined
      if (msgs?.length) markChannelReadLocally(convo.id, msgs[msgs.length - 1]?.id)
    } catch {}
    router.push({
      pathname: '/(doctor)/chat-consultation',
      params: {
        channelId: convo.id,
        consultationId: convo.id,
        patientName: convo.peerName,
        consultationStatus: convo.consultationStatus,
      },
    })
  })

  const handleLongPress = (id: string) => setOpenMenuId(id)
  const handleMenuClose = () => setOpenMenuId(null)

  const handleDelete = async (id: string) => {
    try {
      const channels = await streamClient.queryChannels(
        { id: { $eq: id }, members: { $in: [userId ?? ''] } },
        {},
        { state: false, watch: false, limit: 1 }
      )
      if (channels.length > 0) await channels[0].hide()
    } catch (err) {
      logger.error('[DoctorMessages] hide channel error:', err)
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  const handlePin = async (id: string) => {
    const convo = conversations.find((c) => c.id === id)
    if (!convo) return
    try {
      const channels = await streamClient.queryChannels(
        { id: { $eq: id }, members: { $in: [userId ?? ''] } },
        {},
        { state: false, watch: false, limit: 1 }
      )
      if (channels.length > 0) {
        await channels[0].update({ pinned: !convo.isPinned } as any)
      }
    } catch (err) {
      logger.error('[DoctorMessages] pin channel error:', err)
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c))
    )
  }

  const handleArchive = async (id: string) => {
    try {
      const channels = await streamClient.queryChannels(
        { id: { $eq: id }, members: { $in: [userId ?? ''] } },
        {},
        { state: false, watch: false, limit: 1 }
      )
      if (channels.length > 0) await channels[0].hide()
    } catch (err) {
      logger.error('[DoctorMessages] archive channel error:', err)
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListItem }) => (
    <ConversationItem
      item={item}
      menuVisible={openMenuId === item.id}
      onPress={handlePress}
      onLongPress={handleLongPress}
      onMenuClose={handleMenuClose}
      onDelete={handleDelete}
      onPin={handlePin}
      onArchive={handleArchive}
    />
  )

  const EmptyState = (
    <View style={styles.emptyWrap}>
      <Ionicons name="chatbubbles-outline" size={52} color={colors.steelGrey} />
      <Text style={styles.emptyTitle}>
        {searchQuery ? t('noResultsFound') : t('noMessages')}
      </Text>
      <Text style={styles.emptyText}>
        {searchQuery
          ? `No conversations match "${searchQuery}"`
          : t('noMessagesDesc')}
      </Text>
    </View>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <LinearGradient
        colors={gradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t('messages')}</Text>
          {totalUnread > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchConversations')}
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      {/* ── Content ── */}
      {!isStreamConnected ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="wifi-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.emptyTitle}>{t('notConnected')}</Text>
          <Text style={styles.emptyText}>{t('signInToSeeConversations')}</Text>
        </View>
      ) : loading && conversations.length === 0 ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={
            listItems.length === 0 ? styles.emptyContainer : styles.listContent
          }
          ListEmptyComponent={EmptyState}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.mistWhite,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.mistWhite,
    margin: 16,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    padding: 0,
  },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingBottom: 24 },
  emptyContainer: { flexGrow: 1 },

  separator: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 80 },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
})
