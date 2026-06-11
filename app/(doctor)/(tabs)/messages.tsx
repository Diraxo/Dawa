import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string
  patientName: string
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
  isActive: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const router = useRouter()
  const { isStreamConnected, userId } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // ── Fetch real Stream channels ────────────────────────────────────────────

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
          const patientMember = Object.values(ch.state.members).find(
            (m) => m.user?.id !== userId
          )
          const d = ch.data as Record<string, unknown> | undefined
          const status = (d?.consultationStatus as string) === 'completed' ? 'completed' : 'active'

          let preview = 'No messages yet'
          if (lastMsg) {
            if (lastMsg.text) preview = lastMsg.text
            else if (lastMsg.attachments?.length) preview = '📎 Attachment'
          }

          return {
            id: ch.id ?? '',
            patientName: patientMember?.user?.name ?? 'Patient',
            lastMessage: preview,
            lastMessageTime: formatTime(lastMsg?.created_at),
            unreadCount: ch.countUnread(),
            isActive: status === 'active',
          }
        })
        setConversations(convos)
      } catch (err) {
        console.error('[DoctorMessages] queryChannels error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchChannels()

    const sub = streamClient.on('notification.message_new', () => {
      if (!cancelled) fetchChannels()
    })

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [isStreamConnected, userId])

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.patientName.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleOpen = (conv: Conversation) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
    )
    router.push({
      pathname: '/(doctor)/chat-consultation',
      params: { channelId: conv.id, patientName: conv.patientName },
    })
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <Text style={styles.headerSub}>Your patient conversations</Text>
        </LinearGradient>
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Messages</Text>
            <Text style={styles.headerSub}>Your patient conversations</Text>
          </View>
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
          placeholder="Search conversations..."
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
          <Text style={styles.emptyTitle}>Not connected</Text>
          <Text style={styles.emptyText}>Sign in to see your patient conversations</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubbles-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.emptyTitle}>
            {searchQuery ? 'No results found' : 'No messages yet'}
          </Text>
          <Text style={styles.emptyText}>
            {searchQuery
              ? `No conversations match "${searchQuery}"`
              : 'Patient conversations will appear here once you start consultations'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleOpen(item)}
              style={({ pressed }) => [styles.convRow, pressed && { opacity: 0.85 }]}
            >
              {/* Avatar */}
              <View style={styles.avatarWrap}>
                <View style={[styles.avatar, { backgroundColor: item.isActive ? colors.careBlue : '#9CA3AF' }]}>
                  <Text style={styles.avatarText}>{item.patientName[0].toUpperCase()}</Text>
                </View>
                {item.isActive && <View style={styles.onlineDot} />}
              </View>

              {/* Info */}
              <View style={styles.convInfo}>
                <View style={styles.convTopRow}>
                  <Text style={styles.convName} numberOfLines={1}>{item.patientName}</Text>
                  <Text style={styles.convTime}>{item.lastMessageTime}</Text>
                </View>
                <View style={styles.convBottomRow}>
                  <Text style={styles.convLastMsg} numberOfLines={1}>{item.lastMessage}</Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 4,
  },
  headerBadgeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.mistWhite, margin: 16, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, padding: 0 },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingBottom: 24 },
  convRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.mistWhite, paddingHorizontal: 16, paddingVertical: 14,
  },
  separator: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 78 },

  avatarWrap: { position: 'relative', width: 50, height: 50 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 20, color: colors.mistWhite },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.mistWhite,
  },

  convInfo: { flex: 1 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  convName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, flex: 1, marginRight: 8 },
  convTime: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },
  convBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  convLastMsg: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', flex: 1 },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadText: { fontFamily: fonts.bold, fontSize: 11, color: colors.mistWhite },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.inkBlack, textAlign: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },
})
