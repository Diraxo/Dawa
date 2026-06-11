import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
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
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router = useRouter()
  const { isStreamConnected, userId } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // ── Fetch real channels from Stream ─────────────────────────────────────────

  useEffect(() => {
    if (!isStreamConnected || !userId) return

    let cancelled = false

    const fetchChannels = async () => {
      setLoading(true)
      try {
        const channels = await streamClient.queryChannels(
          { type: 'messaging', members: { $in: [userId] } },
          { last_message_at: -1 },
          { watch: true, state: true, limit: 30 }
        )

        if (cancelled) return

        const convos: Conversation[] = channels.map((ch) => {
          const msgs = ch.state.messages
          const lastMsg = msgs[msgs.length - 1]
          const doctorMember = Object.values(ch.state.members).find(
            (m) => m.user?.id !== userId
          )
          // Custom fields stored when the consultation channel was created
          const d = ch.data as Record<string, unknown> | undefined

          return {
            id: ch.id ?? '',
            doctorId: (d?.doctorId as string | undefined) ?? doctorMember?.user?.id ?? '',
            doctorName:
              (d?.doctorName as string | undefined) ??
              doctorMember?.user?.name ??
              'Doctor',
            doctorSubtitle: (d?.doctorSubtitle as string | undefined) ?? '',
            doctorPhotoUrl:
              (d?.doctorPhotoUrl as string | null | undefined) ??
              (doctorMember?.user?.image as string | undefined) ??
              null,
            lastMessage: lastMsg?.text ?? 'No messages yet',
            lastMessageTime: formatMsgTime(lastMsg?.created_at),
            unreadCount: ch.countUnread(),
            isOnline: doctorMember?.user?.online ?? false,
            isPinned: false,
            consultationStatus:
              ((d?.consultationStatus as string) === 'completed'
                ? 'completed'
                : 'active') as 'active' | 'completed',
          }
        })

        setConversations(convos)
      } catch (err) {
        console.error('[Messages] queryChannels error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchChannels()

    // Real-time: refresh list when a new message arrives in any channel
    const sub = streamClient.on('notification.message_new', () => {
      if (!cancelled) fetchChannels()
    })

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [isStreamConnected, userId])

  // ── Derived data ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.doctorName.toLowerCase().includes(q) ||
        c.doctorSubtitle.toLowerCase().includes(q)
    )
  }, [conversations, searchQuery])

  const pinned = useMemo(() => filtered.filter((c) => c.isPinned), [filtered])
  const others = useMemo(() => filtered.filter((c) => !c.isPinned), [filtered])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePress = (id: string) => {
    const convo = conversations.find((c) => c.id === id)
    if (!convo) return
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    )
    router.push({
      pathname: '/(patient)/chat-consultation',
      params: {
        channelId: convo.id,
        doctorId: convo.doctorId,
        doctorName: convo.doctorName,
        doctorSubtitle: convo.doctorSubtitle,
        consultationStatus: convo.consultationStatus,
      },
    })
  }

  const handleLongPress = (id: string) => setOpenMenuId(id)
  const handleMenuClose = () => setOpenMenuId(null)

  const handleDelete = (id: string) =>
    setConversations((prev) => prev.filter((c) => c.id !== id))

  const handlePin = (id: string) =>
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c))
    )

  const handleArchive = (id: string) =>
    setConversations((prev) => prev.filter((c) => c.id !== id))

  // ── Item render ─────────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Conversation }) => (
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

  // ── Empty / loading states ───────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Inbox</Text>
        </View>
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  const EmptyState = () => (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Ionicons name="chatbubbles-outline" size={48} color={colors.steelGrey} />
      </View>
      <Text style={styles.emptyTitle}>
        {searchQuery ? 'No results found' : 'No messages yet'}
      </Text>
      <Text style={styles.emptySub}>
        {searchQuery
          ? `No conversations match "${searchQuery}"`
          : !isStreamConnected
          ? 'Sign in to see your consultations.'
          : 'Book a consultation to start chatting with a doctor.'}
      </Text>
    </View>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Inbox</Text>
          {totalUnread > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <Pressable style={styles.searchIconBtn} hitSlop={8}>
          <Ionicons name="options-outline" size={22} color={colors.inkBlack} />
        </Pressable>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={17} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search messages..."
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
      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => 'dummy'}
          renderItem={null}
          ListHeaderComponent={
            <>
              {pinned.length > 0 && (
                <>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="pin" size={13} color={colors.tealGreen} />
                    <Text style={styles.sectionLabel}>Pinned</Text>
                  </View>
                  {pinned.map((item) => (
                    <View key={item.id}>
                      {renderItem({ item })}
                      <View style={styles.separator} />
                    </View>
                  ))}
                </>
              )}

              {others.length > 0 && (
                <>
                  {pinned.length > 0 && (
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionLabel}>All Messages</Text>
                    </View>
                  )}
                  {others.map((item, index) => (
                    <View key={item.id}>
                      {renderItem({ item })}
                      {index < others.length - 1 && (
                        <View style={styles.separator} />
                      )}
                    </View>
                  ))}
                </>
              )}

              <View style={styles.bottomPad} />
            </>
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
  searchIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    padding: 0,
  },

  list: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
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

  bottomPad: { height: 24 },
})
