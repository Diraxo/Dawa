import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import type { Channel } from 'stream-chat'

// stream-chat-expo uses a native TurboModule (StreamVideoThumbnail) that is not
// registered in Expo Go — require it lazily so the route doesn't crash on load.
let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
let DefaultAttachment: any = null
let MessageInputCtxHook: () => any = () => ({})
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
  DefaultAttachment = sc.Attachment ?? null
  if (sc.useMessageInputContext) MessageInputCtxHook = sc.useMessageInputContext
} catch {}

function CustomAttachment(props: any) {
  const att = props.attachment ?? props
  if (DefaultAttachment) return <DefaultAttachment {...props} />
  return null
}

// Bridges the Stream MessageInputContext uploadNewFile into a ref accessible from the screen
function UploadBridge({ uploadRef }: { uploadRef: React.MutableRefObject<((f: any) => Promise<void>) | null> }) {
  const ctx = MessageInputCtxHook()
  uploadRef.current = ctx?.uploadNewFile ?? null
  return null
}

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { waitForModalDismiss } from '@/lib/imagePicker'
import { shadow } from '@/lib/shadow'
import { streamClient, preloadImages, getMessageImageUrls } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { markNotificationsReadForConsultation } from '@/lib/notificationCenter'
import { restrictedMessageActions } from '@/lib/chatMessageActions'
import { isPdfAttachment } from '@/lib/pdfAttachment'
import { PdfViewerModal } from '@/components/shared/PdfViewerModal'
import { ConsultationCompletedModal } from '@/components/consultation/ConsultationCompletedModal'
import { VerifiedBadge } from '@/components/ui/VerifiedBadge'
import { useAuth } from '@clerk/clerk-expo'
import { logger } from '@/lib/logger'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useConsultationState } from '@/hooks/useConsultationState'
import { useConsultationCompletion } from '@/hooks/useConsultationCompletion'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { localizeNotificationPhoto } from '@/lib/notificationPhoto'
import { formatDoctorName, stripDrPrefix } from '@/lib/nameFormat'
import { useAuthStore } from '@/store/authStore'
import { useActiveChatStore } from '@/store/activeChatStore'
import { useActiveConsultationScreenStore } from '@/store/activeConsultationScreenStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsultationState = 'countdown' | 'waiting' | 'active' | 'completed'

interface DoctorProfile {
  specialty: string
  years_experience: number
  hospital_name: string
  bio: string
  languages: string[]
  photoUrl: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRemainingSeconds(scheduledAt: string): number {
  return Math.max(0, Math.floor((new Date(scheduledAt).getTime() - Date.now()) / 1000))
}

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function ChatEmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="chatbubbles-outline" size={36} color={colors.tealGreen} />
      </View>
      <Text style={styles.emptyTitle}>Your consultation has started.</Text>
      <Text style={styles.emptySub}>
        Describe your symptoms in as much detail as possible. You may also attach photos or medical documents.
      </Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatConsultationScreen() {
  const {
    channelId,
    doctorId,
    doctorName,
    scheduledAt,
    consultationStatus,
  } = useLocalSearchParams<{
    channelId?: string
    doctorId: string
    doctorName: string
    doctorSubtitle?: string
    scheduledAt?: string
    consultationStatus?: 'active' | 'completed'
  }>()

  const router = useRouter()
  const guardNav = useNavGuard()
  const { t } = useTranslation()
  const { getToken, userId } = useAuth()
  const insets = useSafeAreaInsets()
  const isStreamConnected = useAuthStore((s) => s.isStreamConnected)
  const setActiveChannelId = useActiveChatStore((s) => s.setActiveChannelId)

  // Tracked so app/_layout.tsx's global message listener can tell "already
  // looking at this chat" apart from "elsewhere in the app" and skip a
  // redundant notification for messages that land right here.
  useEffect(() => {
    if (!channelId) return
    setActiveChannelId(channelId)
    return () => setActiveChannelId(null)
  }, [channelId, setActiveChannelId])

  // Auto-clear: reaching this chat directly (tab nav, deep link, resume)
  // rather than by tapping the notification still means it's been "handled"
  // — mark any unread notification for this consultation read so it doesn't
  // sit stale in the tray/badge/Notification Center.
  const dbUserId = useAuthStore((s) => s.userId)
  useEffect(() => {
    if (!channelId || !dbUserId) return
    markNotificationsReadForConsultation(supabase, dbUserId, channelId)
  }, [channelId, dbUserId])

  const setActiveConsultationId = useActiveConsultationScreenStore((s) => s.setActiveConsultationId)
  // Tracked so usePushNotifications.ts's foreground handler can suppress a
  // consultation push (e.g. "Tap to join") that arrives after this exact
  // chat is already open — same purpose as activeChannelId above, scoped to
  // consultation-status pushes instead of Stream messages.
  useEffect(() => {
    if (!channelId) return
    setActiveConsultationId(channelId)
    return () => setActiveConsultationId(null)
  }, [channelId, setActiveConsultationId])

  const initialState: ConsultationState = (() => {
    if (consultationStatus === 'completed') return 'completed'
    if (!scheduledAt) return 'active'
    return getRemainingSeconds(scheduledAt) > 0 ? 'countdown' : 'waiting'
  })()

  const [consultationState, setConsultationState] = useState<ConsultationState>(initialState)
  const [remaining, setRemaining] = useState<number>(
    scheduledAt ? getRemainingSeconds(scheduledAt) : 0
  )
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelWatchFailed, setChannelWatchFailed] = useState(false)
  const [channelRetryTick, setChannelRetryTick] = useState(0)
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string; size?: number } | null>(null)
  const [peerOnline, setPeerOnline] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null)
  const [doctorUserId, setDoctorUserId] = useState<string | null>(null)
  const [doctorInitialName, setDoctorInitialName] = useState<string | null>(null)
  const [doctorInitialPhotoUrl, setDoctorInitialPhotoUrl] = useState<string | null>(null)
  const [doctorStatus, setDoctorStatus] = useState<string | null>(null)
  const doctorClerkIdRef = useRef<string>('')
  // Doctor identity kept live via Realtime — a rename/photo change mid-chat
  // reflects here immediately instead of staying stuck on the fetched value.
  const { name: liveDoctorName, photoUrl: doctorPhotoUrl } = useUserProfileRealtime(
    doctorUserId,
    doctorInitialName ?? doctorName ?? null,
    doctorInitialPhotoUrl
  )

  // Verified badge kept live — an admin approving/suspending the doctor while
  // the patient is sitting on this screen must flip the badge immediately,
  // same as the Messages list (see patient-messages-doctor-status subscription
  // in app/(patient)/(tabs)/messages.tsx). doctorStatus above is otherwise a
  // one-time fetch from the tryWatch effect.
  useEffect(() => {
    if (!doctorUserId) return
    return subscribeRealtime(
      `doctor_profiles:user_id=eq.${doctorUserId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `user_id=eq.${doctorUserId}` }],
      (_event, payload) => {
        const row = payload.new as any
        if (row?.status !== undefined) setDoctorStatus(row.status ?? null)
      },
    )
  }, [doctorUserId])

  // ── Background notification ────────────────────────────────────────────────
  // Mirrors the phone/video screens' "Ongoing Consultation" notification so
  // backgrounding mid-chat also resumes directly into this same chat on tap,
  // instead of relying solely on Stream's own push (which lands on the
  // messages tab, not this consultation thread).
  useEffect(() => {
    const chatDisplayName = liveDoctorName ?? doctorName ?? 'Doctor'
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'background' && consultationState === 'active' && channelId) {
        const localPhotoUri = await localizeNotificationPhoto(doctorPhotoUrl)
        Notifications.scheduleNotificationAsync({
          content: {
            title: `Chat with ${formatDoctorName(chatDisplayName)}`,
            body: `Tap to return to your chat with ${formatDoctorName(chatDisplayName)}`,
            sound: 'default',
            data: {
              screen: 'consultation',
              consultationId: channelId,
              consultationType: 'chat',
              doctorName: chatDisplayName,
              doctorId: doctorId ?? '',
              doctorPhotoUrl: doctorPhotoUrl ?? '',
            },
            ...(localPhotoUri ? { attachments: [{ identifier: 'photo', url: localPhotoUri, type: 'image' }] } : {}),
          },
          trigger: null,
        }).catch(() => {})
      }
    })
    return () => sub.remove()
  }, [consultationState, channelId, doctorId, doctorName, liveDoctorName, doctorPhotoUrl])

  // ── UI State ──────────────────────────────────────────────────────────────────
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  // Report
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetail, setReportDetail] = useState('')
  const [reportSubmitted, setReportSubmitted] = useState(false)

  // Block
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)

  // Search
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Attachment menu
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const uploadFileRef = useRef<((f: any) => Promise<void>) | null>(null)

  useHeartbeat(channelId as string | undefined, consultationState === 'active')

  // ── Live countdown ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (consultationState !== 'countdown' || !scheduledAt) return
    const interval = setInterval(() => {
      const rem = getRemainingSeconds(scheduledAt)
      setRemaining(rem)
      if (rem <= 0) {
        clearInterval(interval)
        setConsultationState('waiting')
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [consultationState, scheduledAt])

  // ── Waiting → active via Supabase Realtime + polling + Stream events ─────

  useEffect(() => {
    if (consultationState !== 'waiting' || !channelId) return

    const applyStatus = (status: string) => {
      if (status === 'accepted' || status === 'in_progress' || status === 'active') {
        setConsultationState('active')
      }
      // Completion is detected exclusively by useConsultationCompletion below —
      // this effect only needs to advance waiting -> active.
    }

    const sub = supabase
      .channel(`patient-chat-status-${channelId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${channelId}` },
        (payload) => applyStatus((payload.new as { status: string }).status)
      )
      .subscribe()

    const streamSub = streamClient.on('notification.message_new', (event: any) => {
      if (event.channel_id === channelId || event.channel?.id === channelId) {
        setConsultationState('active')
      }
    })

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('consultations')
        .select('status')
        .eq('id', channelId)
        .single()
      if (data) applyStatus(data.status)
    }, 1500)

    return () => {
      supabase.removeChannel(sub)
      streamSub.unsubscribe()
      clearInterval(poll)
    }
  }, [consultationState, channelId])

  // ── Single source of truth for reaching a terminal status ────────────────
  // Detection lives in useConsultationState (mount fetch + realtime + poll);
  // useConsultationCompletion owns the one-shot reaction — chat has no
  // Agora/Stream resource that needs explicit teardown (Stream's watch is
  // released on unmount below), so onTeardown just flips the local state
  // machine into 'completed' to drive the existing read-only rendering.
  const completionStatus = useConsultationState({
    consultationId: channelId,
    role: 'patient',
    localAgoraReconnecting: false,
  })
  const completion = useConsultationCompletion({
    phase: completionStatus.phase,
    rawStatus: completionStatus.rawStatus,
    role: 'patient',
    kind: 'chat',
    consultationId: channelId,
    doctorId,
    doctorName,
    onTeardown: () => setConsultationState('completed'),
  })

  // ── Mark consultation in_progress when patient enters active chat ─────────

  useEffect(() => {
    if (consultationState !== 'active' || !channelId) return
    getToken().then(token => {
      if (!token) return
      getAuthClient(token)
        .from('consultations')
        .update({ status: 'in_progress' })
        .eq('id', channelId)
        .in('status', ['accepted', 'active'])
        .then(() => {})
    })
  }, [consultationState, channelId])

  // ── Watch Stream channel once active or completed ──────────────────────────

  useEffect(() => {
    if (consultationState !== 'active' && consultationState !== 'completed') return
    if (!channelId) return
    if (!isStreamConnected) return

    let mounted = true
    let currentChannel: Channel | null = null
    let connSub: { unsubscribe: () => void } | null = null
    setChannelLoading(true)
    setChannelWatchFailed(false)

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const tryWatch = async () => {
      // An unmount during the retry delay below doesn't clear this scheduled
      // call — without this guard it would still run the query and open a
      // Stream watch after cleanup already ran, leaking a watched channel
      // nothing will ever stopWatching().
      if (!mounted) return
      try {
        // Pass members so watch() self-heals channel membership instead of
        // relying solely on membership set up elsewhere at accept-time.
        const { data } = await supabase
          .from('consultations')
          .select('doctor:doctor_profiles(status, user:users(id, clerk_id, full_name, profile_photo_url))')
          .eq('id', channelId)
          .single()
        const doctorClerkId = (data as any)?.doctor?.user?.clerk_id as string | undefined
        doctorClerkIdRef.current = doctorClerkId ?? ''
        setDoctorUserId((data as any)?.doctor?.user?.id ?? null)
        setDoctorInitialName((data as any)?.doctor?.user?.full_name ?? null)
        setDoctorInitialPhotoUrl((data as any)?.doctor?.user?.profile_photo_url ?? null)
        setDoctorStatus((data as any)?.doctor?.status ?? null)
        const members = userId && doctorClerkId ? [userId, doctorClerkId] : undefined
        const ch = streamClient.channel('messaging', channelId, members ? { members } : undefined)
        currentChannel = ch
        try {
          await ch.watch({ presence: true } as any)
        } catch (err) {
          if (!members) throw err
          // Membership may already exist (added by the accept-time create
          // or the doctor's own self-heal watch) — re-sending members on
          // an already-provisioned channel trips Stream's "duplicate
          // members" validation. `channel()` caches one instance per cid, so
          // calling it again here would just hand back this same `ch` with
          // `members` still baked into its data — strip it directly instead.
          if (ch.data) delete (ch.data as any).members
          if ((ch as any)._data) delete (ch as any)._data.members
          await ch.watch({ presence: true } as any)
        }
        if (!mounted) { ch.stopWatching().catch(() => {}); return }
        await preloadImages(getMessageImageUrls(ch.state.messages as any[]))
        if (!mounted) { ch.stopWatching().catch(() => {}); return }
        setActiveChannel(ch)
        if (doctorClerkId) setPeerOnline(!!ch.state.members[doctorClerkId]?.user?.online)
        if (consultationState !== 'completed') ch.markRead().catch(() => {})
        // A dropped socket (backgrounding, network blip) resumes silently —
        // Stream does not automatically re-`watch()` a previously watched
        // channel after reconnect, so live message.new/typing/presence events
        // stop arriving here until the screen is reopened. Matches the
        // website's onStreamReconnect and the doctor screen's equivalent.
        connSub = streamClient.on('connection.changed', (event) => {
          if (mounted && event.online) ch.watch({ presence: true } as any).catch(() => {})
        })
      } catch (err) {
        if (!mounted) return
        if (retries < 5) {
          retries++
          retryTimer = setTimeout(tryWatch, 1200)
        } else {
          logger.error('[Chat] channel watch failed after retries:', err)
          setChannelWatchFailed(true)
        }
      } finally {
        if (mounted) setChannelLoading(false)
      }
    }
    tryWatch()

    return () => {
      mounted = false
      if (retryTimer) clearTimeout(retryTimer)
      connSub?.unsubscribe()
      currentChannel?.stopWatching().catch(() => {})
      setActiveChannel(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, consultationState, isStreamConnected, channelRetryTick])

  // ── Typing indicator ──────────────────────────────────────────────────────
  // The SDK's default <TypingIndicator/> reads Stream's own channel_state,
  // which only clears a stale typing.start after a passive ~7s cleanup timer
  // (see stream-chat's channel_state.ts clean()) — and the default composer
  // never calls stopTyping() when the sender's message actually lands, so the
  // doctor can appear to be "typing…" indefinitely. Track it ourselves and
  // force it off the instant we see proof the peer isn't typing anymore
  // (their message arriving, or an explicit typing.stop), matching the
  // website's behavior instead of trusting the passive timer.
  useEffect(() => {
    if (!activeChannel) { setPeerTyping(false); return }
    const isPeer = (eventUserId?: string) => !!eventUserId && eventUserId !== userId

    const onStart = (event: any) => { if (isPeer(event.user?.id)) setPeerTyping(true) }
    const onStop  = (event: any) => { if (isPeer(event.user?.id)) setPeerTyping(false) }
    const onNewMessage = (event: any) => { if (isPeer(event.message?.user?.id)) setPeerTyping(false) }

    const subs = [
      activeChannel.on('typing.start', onStart),
      activeChannel.on('typing.stop', onStop),
      activeChannel.on('message.new', onNewMessage),
    ]
    return () => {
      subs.forEach(s => s.unsubscribe())
      setPeerTyping(false)
    }
  }, [activeChannel, userId])

  // ── Read receipts ─────────────────────────────────────────────────────────
  // Mirrors the doctor screen: a "Seen" indicator once the doctor has read
  // past the patient's last sent message.
  useEffect(() => {
    if (!activeChannel || !userId) { setPeerReadAt(null); return }
    const isPeer = (id?: string) => !!id && id !== userId

    const members = Object.values(activeChannel.state.members ?? {}) as any[]
    const peerMember = members.find((m) => isPeer(m.user?.id))

    const readState = (activeChannel.state as any).read as Record<string, { last_read?: Date }> | undefined
    const peerRead = peerMember?.user?.id ? readState?.[peerMember.user.id] : undefined
    setPeerReadAt(peerRead?.last_read ? new Date(peerRead.last_read).toISOString() : null)

    const onRead = (event: any) => { if (isPeer(event.user?.id)) setPeerReadAt(event.created_at ?? new Date().toISOString()) }
    const sub = activeChannel.on('message.read', onRead)
    return () => sub.unsubscribe()
  }, [activeChannel, userId])

  // ── Live online/offline indicator — requires `presence: true` above ──────
  useEffect(() => {
    const sub = streamClient.on('user.presence.changed', (event) => {
      if (event.user?.id && event.user.id === doctorClerkIdRef.current) {
        setPeerOnline(!!event.user.online)
      }
    })
    return () => sub.unsubscribe()
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  // This screen is always reached via router.push (Messages tab, Home,
  // Appointments, a notification deep link), so a prior screen is normally
  // already on the stack — router.back() pops straight back to that
  // already-mounted instance. router.replace() instead pushes a *second*,
  // brand-new (tabs) navigator instance on top of the existing one (replace
  // swaps only the current stack entry, it doesn't reuse an earlier matching
  // one further down), leaving the original — with Home's realtime
  // subscriptions/poll interval or Messages' Stream listeners still live —
  // orphaned underneath, permanently mounted and invisible. Matches the
  // doctor screen's equivalent fix. Only cold-start/deep-link entry (no
  // prior screen) has nothing to pop to.
  const goToMessages = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(patient)/(tabs)/messages' as never)
  }

  const handleBack = () => {
    if (consultationState === 'active') {
      Alert.alert(t('leaveConsultation'), t('leaveConsultationMsg'), [
        { text: t('stay'), style: 'cancel' },
        {
          text: t('leave'),
          style: 'destructive',
          onPress: goToMessages,
        },
      ])
    } else {
      goToMessages()
    }
  }

  // Android hardware back previously bypassed the "leave consultation"
  // confirmation above entirely (no BackHandler listener existed), falling
  // through to the native stack's default pop instead of this screen's own
  // routing — kept current via a ref so the listener (registered once) always
  // runs the latest handleBack, not a stale closure over consultationState.
  const handleBackRef = useRef(handleBack)
  handleBackRef.current = handleBack
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackRef.current()
      return true
    })
    return () => sub.remove()
  }, [])

  const handleAvatarPress = async () => {
    if (!doctorProfile && channelId) {
      setProfileLoading(true)
      try {
        // Join through the consultation row instead of querying by `doctorId`
        // directly — that route param is the Stream/Clerk ID (channels are
        // keyed by Clerk IDs), not the Supabase UUID that doctor_profiles.
        // user_id / users.id expect, so a direct .eq() lookup always returned
        // zero rows. Matches the website's fetchPeerProfile approach.
        const { data: consult } = await supabase
          .from('consultations')
          .select('doctor:doctor_profiles(specialty, years_experience, hospital_name, bio, languages, user:users(profile_photo_url))')
          .eq('id', channelId)
          .single()
        const dp = (consult as any)?.doctor
        if (dp) {
          setDoctorProfile({
            specialty: dp.specialty ?? '',
            years_experience: dp.years_experience ?? 0,
            hospital_name: dp.hospital_name ?? '',
            bio: dp.bio ?? '',
            languages: Array.isArray(dp.languages) ? dp.languages : [],
            photoUrl: dp.user?.profile_photo_url ?? null,
          })
        }
      } catch (err) {
        logger.error('[Chat] fetch doctor profile failed:', err)
      } finally {
        setProfileLoading(false)
      }
    }
    setShowProfile(true)
    setShowMoreMenu(false)
  }

  const handleMoreMenuAction = (action: string) => {
    setShowMoreMenu(false)
    if (action === 'profile') {
      handleAvatarPress()
    } else if (action === 'search') {
      setSearchActive(true)
    } else if (action === 'clear') {
      Alert.alert('Clear Chat', 'This will clear the chat from your view. Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => {} },
      ])
    } else if (action === 'report') {
      setShowReportModal(true)
    } else if (action === 'block') {
      setShowBlockModal(true)
    }
  }

  const submitReport = async () => {
    if (!reportReason) return
    try {
      const token = await getToken()
      if (token && channelId) {
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('clerk_id').limit(1).single()
        await client.from('consultation_reports').insert({
          consultation_id: channelId as string,
          reporter_clerk_id: userData?.clerk_id ?? '',
          reporter_role: 'patient',
          reason: reportReason,
          details: reportDetail || null,
        })
      }
    } catch (err) {
      logger.error('[Chat] submitReport error:', err)
    }
    setReportSubmitted(true)
    setTimeout(() => {
      setShowReportModal(false)
      setReportSubmitted(false)
      setReportReason('')
      setReportDetail('')
    }, 1800)
  }

  // Intercepts Stream Chat's message-press handling so PDF attachments open
  // in the in-app viewer instead of the default Linking.openURL, which kicks
  // the user out to Chrome. Every other press type (images, links, replies)
  // falls through to Stream's own defaultHandler untouched.
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

  const pickPhoto = async () => {
    setShowAttachMenu(false)
    await waitForModalDismiss()
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
    await waitForModalDismiss()
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

  const handleLeaveConsultation = () => {
    Alert.alert(
      t('leaveConsultation'),
      'You can return to this consultation from the Messages tab at any time.',
      [
        { text: t('stay'), style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: goToMessages,
        },
      ],
    )
  }

  // ── Doctor info derived from name param, kept live via Realtime ────────────
  const rawDisplayName = liveDoctorName ?? doctorName ?? 'Doctor'
  const displayName = formatDoctorName(rawDisplayName)
  const nameInitial = stripDrPrefix(rawDisplayName).charAt(0).toUpperCase()
  const isCompleted = consultationState === 'completed'

  // ── Countdown screen ───────────────────────────────────────────────────────

  if (consultationState === 'countdown') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerDoctorName} numberOfLines={1}>{displayName}</Text>
              {doctorStatus === 'approved' && <VerifiedBadge size={14} />}
            </View>
            <Text style={styles.headerSub}>{t('upcomingAppointment')}</Text>
          </View>
          <View style={styles.headerPlaceholder} />
        </View>

        <View style={styles.lockBody}>
          <View style={styles.lockIconCircle}>
            <Ionicons name="time-outline" size={54} color={colors.careBlue} />
          </View>
          <Text style={styles.lockTitle}>{t('consultationHasntStarted')}</Text>
          <Text style={styles.lockSub}>{t('appointmentBeginsIn')}</Text>
          <View style={styles.countdownBox}>
            <Text style={styles.countdownText}>{formatCountdown(remaining)}</Text>
          </View>
          <Text style={styles.lockNote}>{t('chatUnlockNote')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Waiting screen ─────────────────────────────────────────────────────────

  if (consultationState === 'waiting') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerDoctorName} numberOfLines={1}>{displayName}</Text>
              {doctorStatus === 'approved' && <VerifiedBadge size={14} />}
            </View>
            <Text style={[styles.headerSub, { color: colors.tealGreen }]}>
              {t('itsTimeWaitingForDoctor')}
            </Text>
          </View>
          <View style={styles.headerPlaceholder} />
        </View>

        <View style={styles.lockBody}>
          <View style={[styles.lockIconCircle, styles.lockIconCircleTeal]}>
            <Ionicons name="hourglass-outline" size={54} color={colors.tealGreen} />
          </View>
          <Text style={styles.lockTitle}>{t('waitingForDoctor')}</Text>
          <Text style={styles.lockSub}>{t('waitingForDoctorDesc')}</Text>
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.dot1]} />
            <View style={[styles.dot, styles.dot2]} />
            <View style={[styles.dot, styles.dot3]} />
          </View>
          <Text style={styles.lockNote}>{t('chatOpenAutoNote')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Active / Completed chat ────────────────────────────────────────────────

  const lastOwnMessage = [...((activeChannel?.state.messages as any[]) ?? [])]
    .reverse()
    .find((m: any) => m.user?.id === userId)
  const isSeen = !!(
    peerReadAt && lastOwnMessage?.created_at &&
    new Date(peerReadAt).getTime() >= new Date(lastOwnMessage.created_at).getTime()
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Search Overlay Modal ── */}
      <Modal visible={searchActive} animationType="slide" onRequestClose={() => { setSearchActive(false); setSearchQuery('') }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.mistWhite }}>
          {/* Search header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, gap: 8 }}>
            <Pressable onPress={() => { setSearchActive(false); setSearchQuery('') }} hitSlop={12} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
            </Pressable>
            <TextInput
              autoFocus
              style={{ flex: 1, height: 40, backgroundColor: colors.cloudGrey, borderRadius: 20, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack }}
              placeholder="Search messages…"
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={12} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-circle" size={20} color={colors.steelGrey} />
              </Pressable>
            )}
          </View>

          {/* Search results */}
          <ScrollView keyboardShouldPersistTaps="handled">
            {searchQuery.trim() && activeChannel ? (() => {
              const results = (activeChannel.state.messages as any[])
                .filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
                .slice(0, 50)
              if (results.length === 0) {
                return (
                  <View style={{ alignItems: 'center', paddingTop: 48, gap: 8 }}>
                    <Ionicons name="search-outline" size={40} color={colors.steelGrey} />
                    <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' }}>No messages found</Text>
                  </View>
                )
              }
              return results.map((m: any) => {
                const msgDate = m.created_at ? new Date(m.created_at) : null
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => { setSearchActive(false); setSearchQuery('') }}
                    style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey }}
                  >
                    <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginBottom: 3 }}>
                      {msgDate ? msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </Text>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack }}>
                      {m.text ?? 'Attachment'}
                    </Text>
                  </Pressable>
                )
              })
            })() : (
              <View style={{ alignItems: 'center', paddingTop: 48, gap: 8 }}>
                <Ionicons name="search-outline" size={40} color={colors.steelGrey} />
                <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' }}>Type to search messages</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Doctor Profile Modal ── */}
      <Modal
        visible={showProfile}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProfile(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowProfile(false)} />
          <View style={[styles.profileSheet, { paddingBottom: Math.max(40, insets.bottom + 16) }]}>
            <View style={styles.modalHandle} />
            {/* Close button */}
            <View style={styles.profileHeader}>
              <Text style={styles.profileLabel}>Doctor Profile</Text>
              <Pressable onPress={() => setShowProfile(false)} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.inkBlack} />
              </Pressable>
            </View>

            {profileLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <ActivityIndicator color={colors.tealGreen} />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Avatar */}
                <View style={styles.profileAvatarWrap}>
                  {doctorProfile?.photoUrl ? (
                    <Image source={{ uri: doctorProfile.photoUrl }} style={styles.profileAvatarImg} />
                  ) : (
                    <View style={styles.profileAvatarFallback}>
                      <Text style={styles.profileAvatarInitial}>{nameInitial}</Text>
                    </View>
                  )}
                  {!isCompleted && <View style={styles.profileOnlineDot} />}
                </View>

                <Text style={styles.profileName}>{displayName}</Text>
                {doctorProfile?.specialty ? (
                  <Text style={styles.profileSpecialty}>{doctorProfile.specialty}</Text>
                ) : null}

                {/* Info rows */}
                {doctorProfile?.years_experience ? (
                  <View style={styles.profileRow}>
                    <Ionicons name="briefcase-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.profileRowText}>{doctorProfile.years_experience} years of experience</Text>
                  </View>
                ) : null}
                {doctorProfile?.hospital_name ? (
                  <View style={styles.profileRow}>
                    <Ionicons name="business-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.profileRowText}>{doctorProfile.hospital_name}</Text>
                  </View>
                ) : null}
                {doctorProfile?.languages?.length ? (
                  <View style={styles.profileRow}>
                    <Ionicons name="language-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.profileRowText}>{doctorProfile.languages.join(', ')}</Text>
                  </View>
                ) : null}
                {doctorProfile?.bio ? (
                  <View style={styles.profileBioWrap}>
                    <Text style={styles.profileBioLabel}>About</Text>
                    <Text style={styles.profileBio}>{doctorProfile.bio}</Text>
                  </View>
                ) : null}

                {!doctorProfile && !profileLoading && (
                  <Text style={styles.profileNoData}>Profile information unavailable.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── More Menu Modal ── */}
      <Modal
        visible={showMoreMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreMenu(false)}
      >
        <Pressable style={styles.moreMenuBackdrop} onPress={() => setShowMoreMenu(false)}>
          <View style={styles.moreMenuSheet}>
            {[
              { id: 'profile', icon: 'person-outline' as const, label: 'View Profile' },
              { id: 'search', icon: 'search-outline' as const, label: 'Search Messages' },
              { id: 'clear', icon: 'trash-outline' as const, label: 'Clear Chat' },
              { id: 'report', icon: 'flag-outline' as const, label: 'Report' },
              { id: 'block', icon: 'ban-outline' as const, label: 'Block' },
            ].map((item, i, arr) => (
              <Pressable
                key={item.id}
                style={[styles.moreMenuItem, i < arr.length - 1 && styles.moreMenuItemBorder]}
                onPress={() => handleMoreMenuAction(item.id)}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={item.id === 'block' || item.id === 'report' ? colors.error : colors.inkBlack}
                />
                <Text style={[
                  styles.moreMenuItemText,
                  (item.id === 'block' || item.id === 'report') && { color: colors.error },
                ]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Report Modal ── */}
      <Modal visible={showReportModal} transparent animationType="slide" onRequestClose={() => setShowReportModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <Pressable style={styles.reportOverlay} onPress={() => !reportSubmitted && setShowReportModal(false)}>
          <Pressable style={[styles.reportSheet, { paddingBottom: Math.max(40, insets.bottom + 16) }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            {reportSubmitted ? (
              <View style={styles.reportSuccessWrap}>
                <View style={styles.reportSuccessIcon}>
                  <Ionicons name="checkmark" size={28} color={colors.tealGreen} />
                </View>
                <Text style={styles.reportSuccessTitle}>Report Submitted</Text>
                <Text style={styles.reportSuccessSub}>Our team will review it shortly. Thank you.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.reportTitle}>Report Consultation</Text>
                <Text style={styles.reportSub}>Select a reason for reporting:</Text>
                {['Inappropriate Language', 'Unprofessional Conduct', 'Technical / Data Issue', 'Other'].map(reason => (
                  <Pressable
                    key={reason}
                    style={[styles.reportOption, reportReason === reason && styles.reportOptionActive]}
                    onPress={() => setReportReason(reason)}
                  >
                    <View style={[styles.reportRadio, reportReason === reason && styles.reportRadioActive]}>
                      {reportReason === reason && <View style={styles.reportRadioDot} />}
                    </View>
                    <Text style={[styles.reportOptionText, reportReason === reason && { color: colors.tealGreen, fontFamily: fonts.semiBold }]}>{reason}</Text>
                  </Pressable>
                ))}
                <TextInput
                  style={styles.reportDetailInput}
                  placeholder="Add details (optional)…"
                  placeholderTextColor="#9CA3AF"
                  value={reportDetail}
                  onChangeText={setReportDetail}
                  multiline
                  numberOfLines={3}
                />
                <Pressable
                  style={[styles.reportSubmitBtn, !reportReason && styles.reportSubmitBtnDisabled]}
                  onPress={submitReport}
                  disabled={!reportReason}
                >
                  <Text style={styles.reportSubmitText}>Submit Report</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Block Confirmation Modal ── */}
      <Modal visible={showBlockModal} transparent animationType="fade" onRequestClose={() => setShowBlockModal(false)}>
        <View style={styles.blockOverlay}>
          <View style={styles.blockSheet}>
            <View style={styles.blockIconCircle}>
              <Ionicons name="ban-outline" size={32} color={colors.error} />
            </View>
            <Text style={styles.blockTitle}>Block {displayName}?</Text>
            <Text style={styles.blockSub}>You will no longer receive messages from this doctor. The consultation history is preserved.</Text>
            <Pressable style={styles.blockConfirmBtn} onPress={() => { setShowBlockModal(false); setIsBlocked(true) }}>
              <Text style={styles.blockConfirmText}>Block Doctor</Text>
            </Pressable>
            <Pressable style={styles.blockCancelBtn} onPress={() => setShowBlockModal(false)}>
              <Text style={styles.blockCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Attachment Menu Modal ── */}
      <Modal visible={showAttachMenu} transparent animationType="slide" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={styles.attachMenuOverlay} onPress={() => setShowAttachMenu(false)}>
          <Pressable style={[styles.attachMenuSheet, { paddingBottom: Math.max(36, insets.bottom + 16) }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.attachMenuTitle}>Add Attachment</Text>
            <Pressable style={styles.attachMenuItem} onPress={pickPhoto}>
              <View style={[styles.attachMenuIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="image-outline" size={22} color="#3B82F6" />
              </View>
              <View style={styles.attachMenuTextWrap}>
                <Text style={styles.attachMenuLabel}>Choose Photo</Text>
                <Text style={styles.attachMenuSub}>Select images from your gallery</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.steelGrey} />
            </Pressable>
            <View style={styles.attachMenuDivider} />
            <Pressable style={styles.attachMenuItem} onPress={pickDocument}>
              <View style={[styles.attachMenuIconCircle, { backgroundColor: '#F0FDFB' }]}>
                <Ionicons name="document-text-outline" size={22} color={colors.tealGreen} />
              </View>
              <View style={styles.attachMenuTextWrap}>
                <Text style={styles.attachMenuLabel}>Choose Document</Text>
                <Text style={styles.attachMenuSub}>PDF, Word, or any file</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.steelGrey} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
        </Pressable>

        <Pressable style={styles.doctorInfo} onPress={handleAvatarPress}>
          <View style={styles.avatarWrap}>
            {doctorPhotoUrl ? (
              <Image source={{ uri: doctorPhotoUrl }} style={styles.avatarCircle} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{nameInitial}</Text>
              </View>
            )}
            {!isCompleted && peerOnline && <View style={styles.onlineDot} />}
          </View>
          <View style={styles.headerTextWrap}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerDoctorName} numberOfLines={1}>{displayName}</Text>
              {doctorStatus === 'approved' && <VerifiedBadge size={14} />}
            </View>
            <View style={styles.statusRow}>
              {!isCompleted && peerOnline && <View style={styles.liveDot} />}
              <Text style={[styles.headerSub, { color: isCompleted || !peerOnline ? '#9CA3AF' : colors.success }]}>
                {isCompleted ? 'Consultation ended' : peerOnline ? t('online') : 'Offline'}
              </Text>
            </View>
          </View>
        </Pressable>

        <Pressable onPress={() => setShowMoreMenu(true)} style={styles.moreBtn} hitSlop={12}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkBlack} />
        </Pressable>
      </View>

      {/* ── Active/Completed status banner ── */}
      {!isCompleted ? (
        <View style={styles.activeBanner}>
          <View style={styles.activeDot} />
          <Text style={styles.activeBannerText}>Active Consultation</Text>
        </View>
      ) : (
        <View style={styles.completedBanner}>
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
          <Text style={styles.completedBannerText}>Consultation Completed</Text>
        </View>
      )}

      {/* ── Stream Chat area ── */}
      {!Chat ? (
        <View style={styles.loadingWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.noChannelTitle}>{t('chatNotConnected')}</Text>
          <Text style={styles.noChannelSub}>{t('chatRequiresBuild')}</Text>
        </View>
      ) : !channelId ? (
        <View style={styles.loadingWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.noChannelTitle}>{t('chatNotConnected')}</Text>
          <Text style={styles.noChannelSub}>{t('channelAvailableWhenDoctorStarts')}</Text>
        </View>
      ) : channelWatchFailed ? (
        <View style={styles.loadingWrap}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.noChannelTitle}>Couldn't connect to chat</Text>
          <Text style={styles.noChannelSub}>Check your internet connection and try again.</Text>
          <Pressable
            onPress={() => setChannelRetryTick((n) => n + 1)}
            style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.tealGreen }}
          >
            <Text style={{ fontFamily: fonts.semiBold, color: '#FFFFFF', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      ) : channelLoading || !activeChannel ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.tealGreen} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={styles.chatArea}>
            <Chat client={streamClient}>
              <ChannelView
                channel={activeChannel}
                Attachment={CustomAttachment}
                handleAttachButtonPress={() => setShowAttachMenu(true)}
                audioRecordingEnabled={false}
                messageActions={(params: any) => restrictedMessageActions(params, () => setShowReportModal(true))}
                onPressMessage={handleMessagePress}
              >
                <UploadBridge uploadRef={uploadFileRef} />
                <MessageList
                  additionalFlatListProps={{ showsVerticalScrollIndicator: false, bounces: false, overScrollMode: 'never' }}
                  supportedReactions={[]}
                  EmptyStateIndicator={ChatEmptyState}
                />
                {isCompleted && (
                  <View style={styles.endedBanner}>
                    <Ionicons name="lock-closed-outline" size={13} color="#6B7280" />
                    <Text style={styles.endedBannerText}>{t('consultationEndedBanner')}</Text>
                  </View>
                )}
                {!isCompleted && peerTyping && (
                  <View style={styles.typingRow}>
                    <Text style={styles.typingText}>{t('typing')}</Text>
                  </View>
                )}
                {!isCompleted && !peerTyping && isSeen && (
                  <View style={styles.typingRow}>
                    <Text style={styles.seenText}>Seen</Text>
                  </View>
                )}
                {!isCompleted && !isBlocked && (
                  <>
                    {/* Security banner */}
                    <View style={styles.securityBanner}>
                      <Ionicons name="lock-closed" size={11} color="#9CA3AF" />
                      <Text style={styles.securityBannerText}>Encrypted and Private</Text>
                    </View>
                    <MessageComposer />
                  </>
                )}
                {!isCompleted && isBlocked && (
                  <View style={styles.blockedBanner}>
                    <Ionicons name="ban-outline" size={16} color={colors.error} />
                    <Text style={styles.blockedBannerText}>You have blocked this doctor. Messaging is disabled.</Text>
                  </View>
                )}
              </ChannelView>
            </Chat>
          </View>
          {isCompleted && (
            <View style={styles.summaryBar}>
              <Pressable
                onPress={guardNav(() => router.push({
                  pathname: '/(patient)/consultation-summary' as any,
                  params: { consultationId: channelId, doctorId, doctorName, consultationType: 'chat' },
                }))}
                style={({ pressed }) => [styles.summaryBtn, pressed && { opacity: 0.82 }]}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.mistWhite} />
                <Text style={styles.summaryBtnText}>{t('viewSummary')}</Text>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      <PdfViewerModal
        visible={!!pdfViewer}
        url={pdfViewer?.url ?? null}
        title={pdfViewer?.title}
        fileSize={pdfViewer?.size}
        onClose={() => setPdfViewer(null)}
      />

      <ConsultationCompletedModal
        visible={completion.showCompletedModal}
        rawStatus={completion.rawStatus}
        onViewSummary={completion.goToSummary}
        onClose={completion.dismissModal}
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.mistWhite,
    borderBottomWidth: 1,
    borderBottomColor: colors.cloudGrey,
    ...shadow('#000', 0, 1, 4, 0.06, 2),
    gap: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerPlaceholder: { width: 36 },
  moreBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  doctorInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTextWrap: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerDoctorName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  headerSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },

  avatarWrap: { position: 'relative', width: 40, height: 40 },
  avatarCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.tealGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2, borderColor: colors.mistWhite,
  },

  // ── Status banners ────────────────────────────────────────────────────────
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F0FDFB',
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#CCFBF1',
  },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.tealGreen },
  activeBannerText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.tealGreen },
  completedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F9FAFB',
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  completedBannerText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.success },

  // ── Ended / completed banner inside chat ─────────────────────────────────
  endedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F9FAFB', borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  endedBannerText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },

  typingRow: { paddingHorizontal: 16, paddingVertical: 4 },
  typingText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', fontStyle: 'italic' },
  seenText: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', textAlign: 'right' },

  // ── Security banner ───────────────────────────────────────────────────────
  securityBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 5, backgroundColor: colors.cloudGrey,
  },
  securityBannerText: { fontFamily: fonts.regular, fontSize: 10, color: '#9CA3AF' },

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatArea: { flex: 1 },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingVertical: 48,
  },
  emptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#F0FDFB',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack,
    textAlign: 'center', marginBottom: 10,
  },
  emptySub: {
    fontFamily: fonts.regular, fontSize: 14, color: '#6B7280',
    textAlign: 'center', lineHeight: 21,
  },

  // ── Summary bar ───────────────────────────────────────────────────────────
  summaryBar: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.mistWhite,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  summaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.tealGreen, borderRadius: 12, height: 48,
  },
  summaryBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.mistWhite },

  // ── Loading ───────────────────────────────────────────────────────────────
  loadingWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  noChannelTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, textAlign: 'center' },
  noChannelSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },

  // ── Profile Modal ─────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  profileSheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 14,
    maxHeight: '80%',
  },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  profileLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.cloudGrey },

  profileAvatarWrap: { alignItems: 'center', marginBottom: 12, position: 'relative', alignSelf: 'center' },
  profileAvatarImg: { width: 84, height: 84, borderRadius: 42 },
  profileAvatarFallback: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarInitial: { fontFamily: fonts.bold, fontSize: 32, color: colors.mistWhite },
  profileOnlineDot: {
    position: 'absolute', bottom: 4, right: -2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.mistWhite,
  },
  profileName: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkBlack, textAlign: 'center', marginBottom: 4 },
  profileSpecialty: { fontFamily: fonts.regular, fontSize: 14, color: colors.tealGreen, textAlign: 'center', marginBottom: 16 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  profileRowText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, flex: 1 },
  profileBioWrap: { marginTop: 16 },
  profileBioLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileBio: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, lineHeight: 21 },
  profileNoData: { fontFamily: fonts.regular, fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 24 },

  // ── More Menu ─────────────────────────────────────────────────────────────
  moreMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'flex-start', paddingTop: 90, alignItems: 'flex-end', paddingRight: 12 },
  moreMenuSheet: {
    backgroundColor: colors.mistWhite, borderRadius: 16,
    ...shadow('#000', 0, 4, 16, 0.12, 8),
    minWidth: 200, overflow: 'hidden',
  },
  moreMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  moreMenuItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  moreMenuItemText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  // ── Report Modal ─────────────────────────────────────────────────────────────
  reportOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  reportSheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 14,
    maxHeight: '90%',
  },
  reportTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack, marginBottom: 6, marginTop: 4 },
  reportSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 14 },
  reportOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.cloudGrey,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    marginBottom: 8,
  },
  reportOptionActive: { borderColor: colors.tealGreen, backgroundColor: '#F0FDFB' },
  reportRadio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  reportRadioActive: { borderColor: colors.tealGreen },
  reportRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealGreen },
  reportOptionText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, flex: 1 },
  reportDetailInput: {
    borderWidth: 1, borderColor: colors.cloudGrey, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack,
    minHeight: 80, textAlignVertical: 'top', marginBottom: 14,
  },
  reportSubmitBtn: {
    backgroundColor: colors.tealGreen, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center',
  },
  reportSubmitBtnDisabled: { opacity: 0.4 },
  reportSubmitText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  reportSuccessWrap: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  reportSuccessIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#F0FDFB', alignItems: 'center', justifyContent: 'center',
  },
  reportSuccessTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack },
  reportSuccessSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center' },

  // ── Block Modal ───────────────────────────────────────────────────────────────
  blockOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 24 },
  blockSheet: {
    backgroundColor: colors.mistWhite, borderRadius: 24,
    paddingHorizontal: 24, paddingVertical: 28,
    alignItems: 'center', gap: 12, width: '100%',
    ...shadow('#000', 0, 8, 24, 0.15, 12),
  },
  blockIconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  blockTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, textAlign: 'center' },
  blockSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },
  blockConfirmBtn: {
    backgroundColor: colors.error, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', width: '100%', marginTop: 4,
  },
  blockConfirmText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  blockCancelBtn: {
    backgroundColor: colors.cloudGrey, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', width: '100%',
  },
  blockCancelText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },

  // ── Blocked state ─────────────────────────────────────────────────────────────
  blockedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FEF2F2', paddingVertical: 14, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: '#FECACA',
  },
  blockedBannerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, flex: 1 },

  // ── Lock / countdown / waiting ─────────────────────────────────────────────
  lockBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  lockIconCircle: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  lockIconCircleTeal: { backgroundColor: '#F0FDFB' },
  lockTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkBlack, textAlign: 'center' },
  lockSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },
  countdownBox: { backgroundColor: colors.mistWhite, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 18, ...shadow(colors.tealGreen, 0, 4, 12, 0.12, 3), marginVertical: 4 },
  countdownText: { fontFamily: fonts.bold, fontSize: 44, color: colors.tealGreen, letterSpacing: 4 },
  lockNote: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, marginTop: 4 },
  dotsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.tealGreen },
  dot1: { opacity: 1 }, dot2: { opacity: 0.6 }, dot3: { opacity: 0.3 },

  // ── Attachment Menu ────────────────────────────────────────────────────────
  attachMenuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  attachMenuSheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 14,
  },
  attachMenuTitle: {
    fontFamily: fonts.semiBold, fontSize: 14, color: '#9CA3AF',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 16, marginTop: 6,
  },
  attachMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14,
  },
  attachMenuIconCircle: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
  },
  attachMenuTextWrap: { flex: 1 },
  attachMenuLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  attachMenuSub: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  attachMenuDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 60 },
})
