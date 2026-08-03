import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Channel } from 'stream-chat'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { streamClient } from '@/lib/stream'
import { isPdfAttachment } from '@/lib/pdfAttachment'
import { PdfViewerModal } from '@/components/shared/PdfViewerModal'

let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
let MessageInputCtxHook: () => any = () => ({})
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
  if (sc.useMessageInputContext) MessageInputCtxHook = sc.useMessageInputContext
} catch {}

// Bridges the Stream MessageInputContext uploadNewFile into a ref accessible
// from this panel — mirrors the same bridge used by the standalone
// chat-consultation.tsx screens.
function UploadBridge({ uploadRef }: { uploadRef: React.MutableRefObject<((f: any) => Promise<void>) | null> }) {
  const ctx = MessageInputCtxHook()
  uploadRef.current = ctx?.uploadNewFile ?? null
  return null
}

interface InCallChatPanelProps {
  visible: boolean
  onClose: () => void
  channel: Channel | null
  channelLoading: boolean
  userId: string | null | undefined
  consultationTypeIcon: 'call' | 'videocam'
  // True once the consultation has been marked completed — hides the
  // composer/attach button so this in-call chat can't send a message after
  // the consultation ended, mirroring the standalone chat screens' isCompleted
  // gating. Defaults to false since most callers never reach this state.
  readOnly?: boolean
}

// Shared in-call chat overlay for all 4 native voice/video screens — was
// previously 4 near-identical copy-pasted implementations using bare
// stream-chat-expo primitives with no keyboard handling, no typing
// indicator, and only the chevron (not the rest of the header) closing the
// panel. One implementation now guarantees the 4 screens can't drift again.
export function InCallChatPanel({
  visible, onClose, channel, channelLoading, userId, consultationTypeIcon, readOnly = false,
}: InCallChatPanelProps) {
  const insets = useSafeAreaInsets()
  const slide = useRef(new Animated.Value(0)).current
  const panelRef = useRef<View>(null)
  const [mounted, setMounted] = useState(visible)
  const [peerTyping, setPeerTyping] = useState(false)
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string; size?: number } | null>(null)
  const [keyboardGap, setKeyboardGap] = useState(0)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [composerHeight, setComposerHeight] = useState(0)
  const uploadFileRef = useRef<((f: any) => Promise<void>) | null>(null)

  // Intercepts Stream Chat's message-press handling so PDF attachments open
  // in the in-app viewer instead of the default Linking.openURL, which kicks
  // the user out to Chrome mid-call. Every other press type falls through to
  // Stream's own defaultHandler untouched.
  const handleMessagePress = (payload: any) => {
    if (payload?.emitter === 'fileAttachment') {
      const attachment = payload.additionalInfo?.attachment
      if (isPdfAttachment(attachment) && attachment?.asset_url) {
        setPdfViewer({ url: attachment.asset_url, title: attachment.title || 'Document.pdf', size: attachment.file_size })
        return
      }
    }
    payload?.defaultHandler?.()
  }

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

  // This panel is a bottom sheet pinned to the literal bottom of the screen
  // (position: absolute, bottom: 0), not to its top, so it never occupies
  // 100% of screen height. KeyboardAvoidingView (and stream-chat-expo's
  // identical internal keyboard handling) measures its offset via onLayout,
  // which is relative to the immediate parent rather than the screen — that
  // under-counts the needed padding by however much screen sits above this
  // panel, leaving the composer hidden behind the keyboard.
  //
  // Rather than deriving the gap from a static Dimensions.get('window') read
  // (which goes stale on Android: windowSoftInputMode="adjustResize" already
  // shrinks the root window to fit around the keyboard, so a stale "full
  // screen height" produces the wrong delta — sometimes under-covering the
  // composer, sometimes double-compensating), measure the panel's *actual*
  // on-screen bottom edge at the moment the keyboard event fires. That
  // self-corrects on both platforms: on Android the panel's measured bottom
  // already equals the keyboard's screenY post-resize (gap ≈ 0, no double
  // padding), on iOS the panel's bottom stays put so the full keyboard
  // height is applied.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = (e: { endCoordinates?: { screenY?: number } }) => {
      const screenY = e?.endCoordinates?.screenY
      if (screenY == null || !panelRef.current) return
      panelRef.current.measureInWindow((_x: number, y: number, _width: number, height: number) => {
        // +8 keeps the composer's rounded bottom edge and send button clear
        // of the keyboard — measuring flush (gap 0) still let the keyboard
        // clip a sliver of the composer on-device.
        setKeyboardGap(Math.max(y + height - screenY, 0) + 8)
      })
    }
    const onHide = () => setKeyboardGap(0)
    const subs = [
      Keyboard.addListener(showEvent, onShow),
      Keyboard.addListener(hideEvent, onHide),
    ]
    return () => subs.forEach(s => s.remove())
  }, [])

  const pickPhoto = async () => {
    setShowAttachMenu(false)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.85,
    })
    if (!result.canceled) {
      for (const asset of result.assets) {
        await uploadFileRef.current?.({
          uri: asset.uri,
          name: asset.fileName ?? `photo_${Date.now()}.jpg`,
          size: asset.fileSize ?? 0,
          type: asset.mimeType ?? 'image/jpeg',
        })
      }
    }
  }

  const pickDocument = async () => {
    setShowAttachMenu(false)
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: true,
    })
    if (!result.canceled) {
      for (const asset of result.assets) {
        await uploadFileRef.current?.({
          uri: asset.uri,
          name: asset.name,
          size: asset.size ?? 0,
          type: asset.mimeType ?? 'application/octet-stream',
        })
      }
    }
  }

  if (!mounted) return null

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [700, 0] })

  // Distance from the panel's bottom edge up to the composer's top edge —
  // used to anchor the attachment popover directly above the composer
  // (matching the website's `absolute bottom-full` placement) regardless of
  // whether the keyboard is currently open.
  const composerOffset = (keyboardGap > 0 ? keyboardGap : insets.bottom) + composerHeight

  return (
    <Animated.View ref={panelRef} style={[styles.panel, { transform: [{ translateY }] }]}>
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
        <View style={{ flex: 1, paddingBottom: keyboardGap }}>
          <Chat client={streamClient}>
            <ChannelView
              channel={channel}
              onPressMessage={handleMessagePress}
              disableKeyboardCompatibleView
              handleAttachButtonPress={() => setShowAttachMenu(v => !v)}
            >
              <UploadBridge uploadRef={uploadFileRef} />
              <MessageList
                additionalFlatListProps={{
                  showsVerticalScrollIndicator: false,
                  bounces: false,
                  overScrollMode: 'never',
                  keyboardShouldPersistTaps: 'handled',
                  keyboardDismissMode: 'on-drag',
                }}
                supportedReactions={[]}
              />
              {readOnly ? (
                <View style={styles.readOnlyBanner}>
                  <Ionicons name="lock-closed-outline" size={13} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.readOnlyText}>This consultation has ended</Text>
                </View>
              ) : (
                <>
                  {peerTyping && (
                    <View style={styles.typingRow}>
                      <Text style={styles.typingText}>Typing…</Text>
                    </View>
                  )}
                  <View onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
                    <MessageComposer />
                  </View>
                </>
              )}
              {/* The composer sits at the panel's literal bottom edge, which is
                  outside the parent screen's SafeAreaView (this panel is an
                  absolutely-positioned overlay) — pad it out ourselves so it
                  doesn't sit under the home indicator / gesture bar. Skipped
                  while the keyboard is up since keyboardGap already covers it. */}
              <View style={{ height: keyboardGap > 0 ? 0 : insets.bottom, backgroundColor: '#10172B' }} />
            </ChannelView>
          </Chat>
        </View>
      )}

      {/* Attachment popover — anchored directly above the composer (never
          below it, never behind the keyboard) whether the keyboard is open
          or closed, mirroring the website's attach-button popover. */}
      {showAttachMenu && (
        <>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowAttachMenu(false)} />
          <View style={[styles.attachPopover, { bottom: composerOffset + 8 }]}>
            <Pressable style={styles.attachMenuItem} onPress={pickPhoto}>
              <View style={[styles.attachMenuIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="image-outline" size={20} color="#3B82F6" />
              </View>
              <View style={styles.attachMenuTextWrap}>
                <Text style={styles.attachMenuLabel}>Choose Photo</Text>
                <Text style={styles.attachMenuSub}>Images from your device</Text>
              </View>
            </Pressable>
            <View style={styles.attachMenuDivider} />
            <Pressable style={styles.attachMenuItem} onPress={pickDocument}>
              <View style={[styles.attachMenuIconCircle, { backgroundColor: '#F0FDFB' }]}>
                <Ionicons name="document-text-outline" size={20} color={colors.tealGreen} />
              </View>
              <View style={styles.attachMenuTextWrap}>
                <Text style={styles.attachMenuLabel}>Choose Document</Text>
                <Text style={styles.attachMenuSub}>PDF, Word, or any file</Text>
              </View>
            </Pressable>
          </View>
        </>
      )}

      <PdfViewerModal
        visible={!!pdfViewer}
        url={pdfViewer?.url ?? null}
        title={pdfViewer?.title}
        fileSize={pdfViewer?.size}
        onClose={() => setPdfViewer(null)}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '80%',
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
  readOnlyBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  readOnlyText: { fontFamily: fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  attachPopover: {
    position: 'absolute', left: 16, width: 230,
    backgroundColor: colors.mistWhite, borderRadius: 14,
    paddingVertical: 6, overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10,
  },
  attachMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  attachMenuIconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  attachMenuTextWrap: { flex: 1 },
  attachMenuLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  attachMenuSub: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  attachMenuDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 14 },
})
