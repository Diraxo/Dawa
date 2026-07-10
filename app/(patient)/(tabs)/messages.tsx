import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { shadow } from '@/lib/shadow'
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'
import { useTranslation } from 'react-i18next'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function attachmentPreview(attachments: readonly any[] | undefined): string | null {
  if (!attachments?.length) return null
  const att = attachments[0] as any
  if (att.type === 'image') return 'Photo'
  if (att.type === 'audio' || (att.mime_type as string | undefined)?.includes('audio')) return 'Voice message'
  if (att.type === 'video') return 'Video'
  return 'File'
}

function formatMsgTime(date: string | Date | null | undefined): string {
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ListItem = Conversation & { type: 'conv' }

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { isStreamConnected, userId } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const [matchingChannelIds, setMatchingChannelIds] = useState<Set<string>>(new Set())
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
            const doctorMember = Object.values(ch.state.members).find(
              (m) => m.user?.id !== userId
            )
            const d = ch.data as Record<string, unknown> | undefined

            return {
              id: ch.id ?? '',
              peerId:
                (d?.doctorId as string | undefined) ??
                doctorMember?.user?.id ??
                '',
              peerName:
                (d?.doctorName as string | undefined) ??
                doctorMember?.user?.name ??
                'Doctor',
              peerSubtitle: (d?.doctorSubtitle as string | undefined) ?? '',
              peerPhotoUrl:
                (doctorMember?.user?.image as string | undefined) ??
                (d?.doctorPhotoUrl as string | null | undefined) ??
                null,
              lastMessage:
                lastMsg?.text ||
                attachmentPreview(lastMsg?.attachments) ||
                'No messages yet',
              lastMessageTime: formatMsgTime(lastMsg?.created_at),
              unreadCount: ch.countUnread(),
              isOnline: doctorMember?.user?.online ?? false,
              isPinned: !!(d as any)?.pinned,
              consultationStatus: (
                (d?.consultationStatus as string) === 'completed'
                  ? 'completed'
                  : 'active'
              ) as 'active' | 'completed',
            }
          })
          setConversations(convos)
        } catch (err) {
          logger.error('[Messages] queryChannels error:', err)
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
            lastMessage:
              msg.text || attachmentPreview(msg.attachments) || 'Message',
            lastMessageTime: formatMsgTime(msg.created_at),
            unreadCount:
              msg.user?.id === userId
                ? updated[idx].unreadCount
                : updated[idx].unreadCount + 1,
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

      // Keep the "Completed" pill live while sitting on this tab — the doctor
      // ending the consultation flips the channel's consultationStatus field
      // (see freeze-consultation-channel edge function), but without this the
      // row wouldn't reflect it until the user navigates away and back.
      const sub4 = streamClient.on('channel.updated', (event) => {
        if (!event.cid) return
        const channelId = event.cid.replace('messaging:', '')
        const status = (event.channel as any)?.consultationStatus
        if (status !== 'completed') return
        setConversations((prev) =>
          prev.map((c) => (c.id === channelId ? { ...c, consultationStatus: 'completed' } : c))
        )
      })

      // Live avatar update — e.g. the doctor changes their profile photo
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

  // ── Stream message content search ─────────────────────────────────────────
  // Finds conversations whose message history (not just the last message)
  // contains the query, so the unified search covers names AND content.

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    const q = searchQuery.trim()
    if (!q || q.length < 2 || !isStreamConnected || !userId) {
      setMatchingChannelIds(new Set())
      return
    }

    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await streamClient.search(
          { type: 'messaging', members: { $in: [userId] } },
          q,
          { limit: 20, offset: 0 }
        )
        const ids = (res.results ?? [])
          .map((r: any) => r.message?.channel_id as string | undefined)
          .filter((id): id is string => !!id)
        setMatchingChannelIds(new Set(ids))
      } catch {
        setMatchingChannelIds(new Set())
      }
    }, 350)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery, isStreamConnected, userId])

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      const nameMatch =
        c.peerName.toLowerCase().includes(q) ||
        c.peerSubtitle.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
      return nameMatch || matchingChannelIds.has(c.id)
    })
  }, [conversations, searchQuery, matchingChannelIds])

  // Pinned conversations float to the top of the single flat list — no
  // section headers, per the "clean list, no banners" navigation-only design.
  const listItems = useMemo<ListItem[]>(() => {
    const pinned = filtered.filter((c) => c.isPinned)
    const others = filtered.filter((c) => !c.isPinned)
    return [...pinned, ...others].map((c) => ({ type: 'conv', ...c }))
  }, [filtered])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePress = (id: string) => {
    const convo = conversations.find((c) => c.id === id)
    if (!convo) return
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    )
    try {
      const ch = Object.values(streamClient.activeChannels).find(
        (c: any) => c.id === convo.id
      )
      ch?.markRead().catch(() => {})
    } catch {}
    router.push({
      pathname: '/(patient)/chat-consultation',
      params: {
        channelId: convo.id,
        doctorId: convo.peerId,
        doctorName: convo.peerName,
        doctorSubtitle: convo.peerSubtitle,
        consultationStatus: convo.consultationStatus,
      },
    })
  }

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
      logger.error('[Messages] hide channel error:', err)
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
      logger.error('[Messages] pin channel error:', err)
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
      logger.error('[Messages] archive channel error:', err)
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListItem }) => {
    return (
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
  }

  const EmptyState = (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Ionicons name="chatbubbles-outline" size={48} color={colors.steelGrey} />
      </View>
      <Text style={styles.emptyTitle}>
        {searchQuery ? 'No results found' : t('noMessages')}
      </Text>
      <Text style={styles.emptySub}>
        {searchQuery
          ? `No conversations match "${searchQuery}"`
          : !isStreamConnected
          ? 'Sign in to see your consultations.'
          : t('noMessagesDesc')}
      </Text>
    </View>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{t('messages')}</Text>
          {totalUnread > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={17} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchConversations')}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Conversation list ── */}
      {loading && conversations.length === 0 ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={EmptyState}
          contentContainerStyle={
            listItems.length === 0 ? styles.emptyContainer : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cloudGrey,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.inkBlack,
  },
  headerBadge: {
    backgroundColor: colors.tealGreen,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  headerBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.mistWhite,
  },

  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    padding: 0,
  },

  list: { flex: 1 },
  listContent: { paddingBottom: 24 },
  emptyContainer: { flexGrow: 1 },

  separator: {
    height: 1,
    backgroundColor: colors.cloudGrey,
    marginLeft: 80,
  },

  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.mistWhite,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
})
