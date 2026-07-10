import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { Channel } from 'stream-chat'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { streamClient } from '@/lib/stream'

let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
} catch {}

interface InCallChatPanelProps {
  visible: boolean
  onClose: () => void
  channel: Channel | null
  channelLoading: boolean
  userId: string | null | undefined
  consultationTypeIcon: 'call' | 'videocam'
}

// Shared in-call chat overlay for all 4 native voice/video screens — was
// previously 4 near-identical copy-pasted implementations using bare
// stream-chat-expo primitives with no keyboard handling, no typing
// indicator, and only the chevron (not the rest of the header) closing the
// panel. One implementation now guarantees the 4 screens can't drift again.
export function InCallChatPanel({
  visible, onClose, channel, channelLoading, userId, consultationTypeIcon,
}: InCallChatPanelProps) {
  const slide = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)
  const [peerTyping, setPeerTyping] = useState(false)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.spring(slide, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start()
    } else {
      Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [visible, slide])

  // Track typing ourselves rather than relying on stream-chat-expo's default
  // typing state — that only clears a stale typing.start via a passive ~7s
  // timer and the default composer doesn't call stopTyping() on send, so the
  // peer can appear to be "typing…" indefinitely. Mirrors the standalone
  // chat screens' (chat-consultation.tsx) already-debugged approach.
  useEffect(() => {
    if (!channel) { setPeerTyping(false); return }
    const isPeer = (eventUserId?: string) => !!eventUserId && eventUserId !== userId
    const onStart = (event: any) => { if (isPeer(event.user?.id)) setPeerTyping(true) }
    const onStop = (event: any) => { if (isPeer(event.user?.id)) setPeerTyping(false) }
    const onNewMessage = (event: any) => { if (isPeer(event.message?.user?.id)) setPeerTyping(false) }
    const subs = [
      channel.on('typing.start', onStart),
      channel.on('typing.stop', onStop),
      channel.on('message.new', onNewMessage),
    ]
    return () => {
      subs.forEach(s => s.unsubscribe())
      setPeerTyping(false)
    }
  }, [channel, userId])

  useEffect(() => {
    if (visible) channel?.markRead().catch(() => {})
  }, [visible, channel])

  if (!mounted) return null

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [700, 0] })

  return (
    <Animated.View style={[styles.panel, { transform: [{ translateY }] }]}>
      {/* Entire header is tappable — not just the chevron — to close and return to the call. */}
      <Pressable onPress={onClose} style={styles.header}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>In-call chat</Text>
          <View style={styles.continuesPill}>
            <Ionicons name={consultationTypeIcon} size={13} color={colors.tealGreen} />
            <Text style={styles.continuesText}>Call continues</Text>
          </View>
          <Ionicons name="chevron-down" size={22} color="rgba(255,255,255,0.7)" />
        </View>
      </Pressable>

      {!Chat ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyText}>Chat unavailable in Expo Go</Text>
          <Text style={styles.emptyHint}>Use a development build to enable chat</Text>
        </View>
      ) : channelLoading || !channel ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.tealGreen} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Chat client={streamClient}>
            <ChannelView channel={channel}>
              <MessageList
                additionalFlatListProps={{ showsVerticalScrollIndicator: false, bounces: false, overScrollMode: 'never' }}
                supportedReactions={[]}
              />
              {peerTyping && (
                <View style={styles.typingRow}>
                  <Text style={styles.typingText}>Typing…</Text>
                </View>
              )}
              <MessageComposer />
            </ChannelView>
          </Chat>
        </KeyboardAvoidingView>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '72%',
    backgroundColor: '#10172B',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5, shadowRadius: 16,
  },
  header: { paddingTop: 8 },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.mistWhite, flex: 1 },
  continuesPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,191,165,0.12)', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  continuesText: { fontFamily: fonts.medium, fontSize: 11, color: colors.tealGreen },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontFamily: fonts.semiBold, fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  emptyHint: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.35)' },
  typingRow: { paddingHorizontal: 16, paddingBottom: 4 },
  typingText: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' },
})
