import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context'
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
  if (DefaultAttachment) return <DefaultAttachment {...props} />
  return null
}

// Bridges the Stream MessageInputContext uploadNewFile into a ref accessible from the screen
function UploadBridge({ uploadRef }: { uploadRef: React.MutableRefObject<((f: any) => Promise<void>) | null> }) {
  const ctx = MessageInputCtxHook()
  uploadRef.current = ctx?.uploadNewFile ?? null
  return null
}

import { EndConsultationSheet, type ConsultationSummaryData } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { waitForModalDismiss } from '@/lib/imagePicker'
import { shadow } from '@/lib/shadow'
import { streamClient, preloadImages, getMessageImageUrls } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { restrictedMessageActions } from '@/lib/chatMessageActions'
import { logger } from '@/lib/logger'
import { markChannelReadLocally } from '@/lib/readCache'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { useActiveChatStore } from '@/store/activeChatStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatientProfile {
  full_name: string
  gender: string | null
  country: string | null
  profile_photo_url: string | null
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function ChatEmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="chatbubbles-outline" size={36} color={colors.tealGreen} />
      </View>
      <Text style={styles.emptyTitle}>Consultation started.</Text>
      <Text style={styles.emptySub}>
        Send the first message to begin the consultation.
      </Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DoctorChatConsultationScreen() {
  const { channelId, consultationId, patientName, patientId, consultationStatus } = useLocalSearchParams<{
    channelId?: string
    consultationId?: string
    patientName?: string
    patientId?: string
    consultationStatus?: string
  }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { getToken, userId } = useAuth()
  const [showEndSheet, setShowEndSheet] = useState(false)
  // `consultationStatus` is only a fast-path hint passed from the messages list
  // (avoids a flash of "Active" before the fetch below resolves) — the effect
  // below fetches the authoritative status and subscribes to live changes,
  // since this screen can also be reached via a deep link/notification that
  // doesn't carry the param.
  const [ended, setEnded] = useState(consultationStatus === 'completed')
  const [submitting, setSubmitting] = useState(false)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)
  const [peerOnline, setPeerOnline] = useState<boolean | null>(null)
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null)
  const [patientPhotoUrl, setPatientPhotoUrl] = useState<string | null>(null)

  // ── UI State ────────────────────────────────────────────────────────────────
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null)
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

  useHeartbeat(consultationId as string | undefined, !ended)

  const displayName = patientName ?? 'Patient'
  const nameInitial = displayName.charAt(0).toUpperCase()
  const effectiveChannelId = channelId ?? consultationId

  const setActiveChannelId = useActiveChatStore((s) => s.setActiveChannelId)
  // Tracked so app/_layout.tsx's global message listener can tell "already
  // looking at this chat" apart from "elsewhere in the app" and skip a
  // redundant notification for messages that land right here.
  useEffect(() => {
    if (!effectiveChannelId) return
    setActiveChannelId(effectiveChannelId)
    return () => setActiveChannelId(null)
  }, [effectiveChannelId, setActiveChannelId])

  // Mark consultation in_progress when doctor enters the chat room
  useEffect(() => {
    if (!consultationId) return
    getToken().then(token => {
      if (!token) return
      getAuthClient(token)
        .from('consultations')
        .update({ status: 'in_progress' })
        .eq('id', consultationId)
        .in('status', ['accepted', 'active'])
        .then(() => {})
    })
  }, [consultationId])

  // Verify the consultation is still active — the `consultationStatus` route
  // param above is only a fast-path hint (may be stale or absent, e.g. via a
  // deep link), so fetch the authoritative status here and subscribe to
  // changes so `ended` flips to true live if it's completed elsewhere.
  useEffect(() => {
    if (!consultationId) return
    let mounted = true

    const applyStatus = (status: string | undefined) => {
      if (!mounted || !status) return
      if (['completed', 'declined', 'cancelled'].includes(status)) {
        setEnded(true)
      }
    }

    supabase
      .from('consultations')
      .select('status')
      .eq('id', consultationId)
      .single()
      .then(({ data }) => applyStatus((data as any)?.status))

    const sub = supabase
      .channel(`doctor-chat-end-${consultationId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` },
        (payload) => applyStatus((payload.new as { status: string }).status)
      )
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(sub)
    }
  }, [consultationId])

  // Watch the Stream channel so messages load
  useEffect(() => {
    if (!effectiveChannelId) return
    let mounted = true
    let currentChannel: Channel | null = null
    let connSub: { unsubscribe: () => void } | null = null
    setChannelLoading(true)

    let retries = 0
    const tryWatch = async () => {
      try {
        // Pass members so watch() self-heals channel membership instead of
        // relying solely on membership set up elsewhere at accept-time.
        const { data } = await supabase
          .from('consultations')
          .select('patient:users!patient_id(clerk_id, profile_photo_url)')
          .eq('id', effectiveChannelId)
          .single()
        const patientClerkId = (data as any)?.patient?.clerk_id as string | undefined
        setPatientPhotoUrl((data as any)?.patient?.profile_photo_url ?? null)
        const members = userId && patientClerkId ? [userId, patientClerkId] : undefined
        const ch = streamClient.channel('messaging', effectiveChannelId, members ? { members } : undefined)
        currentChannel = ch
        await ch.watch({ presence: true })
        if (!mounted) return
        await preloadImages(getMessageImageUrls(ch.state.messages as any[]))
        if (!mounted) return
        setActiveChannel(ch)
        if (!ended) {
          ch.markRead().catch(() => {})
          const msgs = ch.state.messages as any[]
          markChannelReadLocally(effectiveChannelId, msgs[msgs.length - 1]?.id)
        }
        // A dropped socket resumes silently — re-`watch()` on reconnect so
        // messages sent while offline aren't stuck until the screen reopens.
        // Must re-request presence too, or the peer's online/offline state
        // goes stale after any reconnect.
        connSub = streamClient.on('connection.changed', (event) => {
          if (mounted && event.online) ch.watch({ presence: true } as any).catch(() => {})
        })
      } catch (err) {
        if (!mounted) return
        if (retries < 5) {
          retries++
          setTimeout(tryWatch, 1200)
        } else {
          logger.error('[DoctorChat] channel watch failed after retries:', err)
        }
      } finally {
        if (mounted) setChannelLoading(false)
      }
    }
    tryWatch()

    return () => {
      mounted = false
      connSub?.unsubscribe()
      currentChannel?.stopWatching().catch(() => {})
      setActiveChannel(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveChannelId])

  // ── Typing indicator ──────────────────────────────────────────────────────
  // The SDK's default <TypingIndicator/> reads Stream's own channel_state,
  // which only clears a stale typing.start after a passive ~7s cleanup timer,
  // and the default composer never calls stopTyping() when the sender's
  // message actually lands — so the patient can appear to be "typing…"
  // indefinitely. Track it ourselves and force it off the instant we see
  // proof the peer isn't typing anymore (their message arriving, or an
  // explicit typing.stop), matching the website's behavior.
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

  // ── Presence + read receipts ──────────────────────────────────────────────
  // Mirrors the website's ConsultationChatThread: presence dot in the header
  // (was previously a static "Active Session" label with no live patient
  // presence at all) and a "Seen" indicator once the patient has read past
  // the doctor's last sent message.
  useEffect(() => {
    if (!activeChannel || !userId) { setPeerOnline(null); setPeerReadAt(null); return }
    const isPeer = (id?: string) => !!id && id !== userId

    const members = Object.values(activeChannel.state.members ?? {}) as any[]
    const peerMember = members.find((m) => isPeer(m.user?.id))
    setPeerOnline(peerMember?.user?.online ?? null)

    const readState = (activeChannel.state as any).read as Record<string, { last_read?: Date }> | undefined
    const peerRead = peerMember?.user?.id ? readState?.[peerMember.user.id] : undefined
    setPeerReadAt(peerRead?.last_read ? new Date(peerRead.last_read).toISOString() : null)

    const onPresence = (event: any) => { if (isPeer(event.user?.id)) setPeerOnline(!!event.user?.online) }
    const onRead = (event: any) => { if (isPeer(event.user?.id)) setPeerReadAt(event.created_at ?? new Date().toISOString()) }

    const subs = [
      activeChannel.on('user.presence.changed', onPresence),
      activeChannel.on('message.read', onRead),
    ]
    return () => subs.forEach(s => s.unsubscribe())
  }, [activeChannel, userId])

  const lastOwnMessage = [...((activeChannel?.state.messages as any[]) ?? [])]
    .reverse()
    .find((m: any) => m.user?.id === userId)
  const isSeen = !!(
    peerReadAt && lastOwnMessage?.created_at &&
    new Date(peerReadAt).getTime() >= new Date(lastOwnMessage.created_at).getTime()
  )

  const handleAvatarPress = async () => {
    if (!patientProfile && effectiveChannelId) {
      setProfileLoading(true)
      try {
        // Join through the consultation row instead of querying `users` by
        // `patientId` directly — most navigation entry points into this
        // screen (Messages tab, Consultations tab, push-notification deep
        // link) never actually pass patientId, and even when they do it can
        // be a Clerk ID rather than the Supabase UUID `users.id` expects.
        // Going through the consultation row needs only the id we already
        // have, so it works from every entry point.
        const { data } = await supabase
          .from('consultations')
          .select('patient:users!patient_id(full_name, gender, country, profile_photo_url)')
          .eq('id', effectiveChannelId)
          .single()
        const patient = (data as any)?.patient
        if (patient) {
          setPatientProfile({
            full_name: patient.full_name ?? displayName,
            gender: patient.gender ?? null,
            country: patient.country ?? null,
            profile_photo_url: patient.profile_photo_url ?? null,
          })
        }
      } catch (err) {
        logger.error('[DoctorChat] fetch patient profile failed:', err)
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
    } else if (action === 'history') {
      if (patientId) {
        router.push({ pathname: '/(doctor)/patient-history' as any, params: { patientId, patientName: displayName } })
      } else if (effectiveChannelId) {
        // Same reachability gap as handleAvatarPress above — most entry
        // points into this screen never pass patientId (or pass a Clerk ID,
        // not the Supabase UUID patient-history expects). Resolve it through
        // the consultation row instead so "Patient History" works regardless
        // of how the doctor navigated here.
        supabase
          .from('consultations')
          .select('patient:users!patient_id(id)')
          .eq('id', effectiveChannelId)
          .single()
          .then(({ data }) => {
            const resolvedPatientId = (data as any)?.patient?.id
            if (resolvedPatientId) {
              router.push({ pathname: '/(doctor)/patient-history' as any, params: { patientId: resolvedPatientId, patientName: displayName } })
            }
          })
      }
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
      const docConsultationId = consultationId ?? effectiveChannelId
      if (token && docConsultationId) {
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('clerk_id').limit(1).single()
        await client.from('consultation_reports').insert({
          consultation_id: docConsultationId as string,
          reporter_clerk_id: userData?.clerk_id ?? '',
          reporter_role: 'doctor',
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

  const handleEndSubmit = async (data: ConsultationSummaryData) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (token && consultationId) {
        const client = getAuthClient(token)

        const { data: consult } = await client
          .from('consultations')
          .select('started_at')
          .eq('id', consultationId)
          .single()
        const endedAt = new Date().toISOString()
        const durationMinutes = consult?.started_at
          ? Math.max(1, Math.ceil((new Date(endedAt).getTime() - new Date(consult.started_at).getTime()) / 60000))
          : null

        const { error: summaryError } = await client.from('consultation_summaries').upsert({
          consultation_id: consultationId,
          chief_complaint: data.chiefComplaint,
          diagnosis: data.diagnosis,
          prescription: data.prescriptions.length > 0 ? JSON.stringify(data.prescriptions) : null,
          followup_recommendation: data.followUp || null,
          referral_needed: data.referralNeeded,
          referral_specialty: data.referralNeeded && data.referralSpecialty?.trim() ? data.referralSpecialty.trim() : null,
        }, { onConflict: 'consultation_id' })
        if (summaryError) {
          logger.error('[DoctorChat] failed to save summary:', summaryError)
          setSubmitting(false)
          Alert.alert(t('profileSaveError'), t('somethingWentWrong'))
          return
        }
        const { error: statusError } = await client
          .from('consultations')
          .update({ status: 'completed', ended_at: endedAt, duration_minutes: durationMinutes })
          .eq('id', consultationId)
        if (statusError) {
          logger.error('[DoctorChat] failed to mark consultation completed:', statusError)
          setSubmitting(false)
          Alert.alert(t('profileSaveError'), t('somethingWentWrong'))
          return
        }
        // Stream channel locking is now handled server-side by a DB trigger
        // (on_consultation_change → freeze-consultation-channel Edge Function)
        // the instant status flips to 'completed' above — no client call needed.
      }
    } catch (err) {
      logger.error('[DoctorChat] failed to save summary:', err)
      setSubmitting(false)
      Alert.alert(t('profileSaveError'), t('somethingWentWrong'))
      return
    }
    setSubmitting(false)
    setShowEndSheet(false)
    setEnded(true)
    Alert.alert(
      'Consultation Completed',
      'The summary has been saved. The patient has been notified and this conversation is now read-only.',
    )
  }

  if (!effectiveChannelId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.replace('/(doctor)/(tabs)/messages' as never)}
            style={styles.backBtn}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{displayName}</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.tealGreen} size="large" />
          <Text style={styles.noChannelText}>{t('connectingToConsultation')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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

      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => !submitting && setShowEndSheet(false)}
        />
      )}

      {/* ── Report Modal ── */}
      <Modal visible={showReportModal} transparent animationType="slide" onRequestClose={() => setShowReportModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <Pressable style={styles.reportOverlay} onPress={() => !reportSubmitted && setShowReportModal(false)}>
          <Pressable style={styles.reportSheet} onPress={() => {}}>
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
            <Text style={styles.blockSub}>You will no longer receive messages from this patient. The consultation history is preserved.</Text>
            <Pressable style={styles.blockConfirmBtn} onPress={() => { setShowBlockModal(false); setIsBlocked(true) }}>
              <Text style={styles.blockConfirmText}>Block Patient</Text>
            </Pressable>
            <Pressable style={styles.blockCancelBtn} onPress={() => setShowBlockModal(false)}>
              <Text style={styles.blockCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Patient Profile Modal ── */}
      <Modal
        visible={showProfile}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProfile(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowProfile(false)} />
          <View style={styles.profileSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.profileHeader}>
              <Text style={styles.profileLabel}>Patient Profile</Text>
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
                <View style={styles.profileAvatarWrap}>
                  {patientProfile?.profile_photo_url ? (
                    <Image source={{ uri: patientProfile.profile_photo_url }} style={styles.profileAvatarImg} />
                  ) : (
                    <View style={styles.profileAvatarFallback}>
                      <Text style={styles.profileAvatarInitial}>{nameInitial}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.profileName}>{patientProfile?.full_name ?? displayName}</Text>
                <Text style={styles.profileSubtitle}>Patient</Text>
                {patientProfile?.gender ? (
                  <View style={styles.profileRow}>
                    <Ionicons name="person-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.profileRowText}>{patientProfile.gender}</Text>
                  </View>
                ) : null}
                {patientProfile?.country ? (
                  <View style={styles.profileRow}>
                    <Ionicons name="location-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.profileRowText}>{patientProfile.country}</Text>
                  </View>
                ) : null}
                {!patientProfile && !profileLoading && (
                  <Text style={styles.profileNoData}>Profile information unavailable.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── More Menu ── */}
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
              { id: 'history', icon: 'time-outline' as const, label: 'Patient History' },
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

      {/* ── Attachment Menu Modal ── */}
      <Modal visible={showAttachMenu} transparent animationType="slide" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={styles.attachMenuOverlay} onPress={() => setShowAttachMenu(false)}>
          <Pressable style={styles.attachMenuSheet} onPress={() => {}}>
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
        <Pressable
          onPress={() => router.replace('/(doctor)/(tabs)/messages' as never)}
          style={styles.backBtn}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
        </Pressable>

        <Pressable style={styles.patientInfo} onPress={handleAvatarPress}>
          {patientPhotoUrl ? (
            <Image source={{ uri: patientPhotoUrl }} style={styles.avatarCircle} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{nameInitial}</Text>
            </View>
          )}
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
            <View style={styles.statusRow}>
              {!ended && <View style={[styles.liveDot, peerOnline === false && styles.liveDotOffline]} />}
              <Text style={[styles.headerStatus, ended && styles.headerStatusEnded]}>
                {ended ? t('consultationEnded') : peerOnline === null ? t('activeSession') : peerOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          {!ended ? (
            <Pressable
              onPress={() => setShowEndSheet(true)}
              style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.endBtnText}>{t('end')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.replace('/(doctor)/(tabs)/consultations')}
              style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowMoreMenu(true)} style={styles.moreBtn} hitSlop={12}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.inkBlack} />
          </Pressable>
        </View>
      </View>

      {/* ── Active/Ended banner ── */}
      {!ended ? (
        <View style={styles.activeBanner}>
          <View style={styles.activeDot} />
          <Text style={styles.activeBannerText}>Active Consultation</Text>
        </View>
      ) : (
        <View style={styles.endedTopBanner}>
          <Ionicons name="lock-closed-outline" size={13} color="#6B7280" />
          <Text style={styles.endedTopText}>{t('consultationEndedChatReadOnly')}</Text>
        </View>
      )}

      {/* Chat area */}
      {!Chat ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.tealGreen} size="large" />
          <Text style={styles.noChannelText}>{t('chatRequiresDevelopmentBuild')}</Text>
        </View>
      ) : channelLoading || !activeChannel ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.tealGreen} size="large" />
          <Text style={styles.noChannelText}>
            {channelId ? t('connectingToConsultation') : t('waitingForChannelConnection')}
          </Text>
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
              >
                <UploadBridge uploadRef={uploadFileRef} />
                <MessageList
                  additionalFlatListProps={{ showsVerticalScrollIndicator: false, bounces: false, overScrollMode: 'never' }}
                  supportedReactions={[]}
                  EmptyStateIndicator={ChatEmptyState}
                />
                {!ended && peerTyping && (
                  <View style={styles.typingRow}>
                    <Text style={styles.typingText}>{t('typing')}</Text>
                  </View>
                )}
                {!ended && !peerTyping && isSeen && (
                  <View style={styles.typingRow}>
                    <Text style={styles.seenText}>Seen</Text>
                  </View>
                )}
                {ended && (
                  <View style={styles.completedComposerBar}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.tealGreen} />
                    <Text style={styles.completedComposerText}>Consultation Completed</Text>
                  </View>
                )}
                {!ended && !isBlocked && (
                  <>
                    <View style={styles.securityBanner}>
                      <Ionicons name="lock-closed" size={11} color="#9CA3AF" />
                      <Text style={styles.securityBannerText}>Encrypted and Private</Text>
                    </View>
                    <MessageComposer />
                  </>
                )}
                {!ended && isBlocked && (
                  <View style={styles.blockedBanner}>
                    <Ionicons name="ban-outline" size={16} color={colors.error} />
                    <Text style={styles.blockedBannerText}>You have blocked this patient. Messaging is disabled.</Text>
                  </View>
                )}
              </ChannelView>
            </Chat>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.mistWhite,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
    ...shadow('#000', 0, 1, 4, 0.06, 2),
    gap: 8,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  moreBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  patientInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveDotOffline: { backgroundColor: colors.steelGrey },
  headerStatus: { fontFamily: fonts.regular, fontSize: 12, color: colors.success },
  headerStatusEnded: { color: '#9CA3AF' },

  avatarCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },

  endBtn: { backgroundColor: colors.error, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  endBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
  doneBtn: { backgroundColor: colors.tealGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  doneBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },

  // ── Banners ───────────────────────────────────────────────────────────────
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F0FDFB', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#CCFBF1',
  },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.tealGreen },
  activeBannerText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.tealGreen },
  endedTopBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F9FAFB', paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  endedTopText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },

  securityBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 5, backgroundColor: colors.cloudGrey,
  },
  securityBannerText: { fontFamily: fonts.regular, fontSize: 10, color: '#9CA3AF' },

  completedComposerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  completedComposerText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },

  typingRow: { paddingHorizontal: 16, paddingVertical: 4 },
  typingText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', fontStyle: 'italic' },
  seenText: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', textAlign: 'right' },

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatArea: { flex: 1 },

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 48 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F0FDFB', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, textAlign: 'center', marginBottom: 10 },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },

  // ── Loading ───────────────────────────────────────────────────────────────
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  noChannelText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },

  // ── Profile Modal ─────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  profileSheet: { backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 14, maxHeight: '70%' },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  profileLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.cloudGrey },

  profileAvatarWrap: { alignItems: 'center', marginBottom: 12, alignSelf: 'center' },
  profileAvatarImg: { width: 84, height: 84, borderRadius: 42 },
  profileAvatarFallback: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center' },
  profileAvatarInitial: { fontFamily: fonts.bold, fontSize: 32, color: colors.mistWhite },
  profileName: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkBlack, textAlign: 'center', marginBottom: 4 },
  profileSubtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  profileRowText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, flex: 1 },
  profileNoData: { fontFamily: fonts.regular, fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 24 },

  // ── More Menu ─────────────────────────────────────────────────────────────
  moreMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'flex-start', paddingTop: 90, alignItems: 'flex-end', paddingRight: 12 },
  moreMenuSheet: { backgroundColor: colors.mistWhite, borderRadius: 16, ...shadow('#000', 0, 4, 16, 0.12, 8), minWidth: 200, overflow: 'hidden' },
  moreMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  moreMenuItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  moreMenuItemText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  // ── Report Modal ─────────────────────────────────────────────────────────────
  reportOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  reportSheet: { backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 14, maxHeight: '90%' },
  reportTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack, marginBottom: 6, marginTop: 4 },
  reportSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 14 },
  reportOption: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.cloudGrey, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  reportOptionActive: { borderColor: colors.tealGreen, backgroundColor: '#F0FDFB' },
  reportRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  reportRadioActive: { borderColor: colors.tealGreen },
  reportRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealGreen },
  reportOptionText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, flex: 1 },
  reportDetailInput: { borderWidth: 1, borderColor: colors.cloudGrey, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, minHeight: 80, textAlignVertical: 'top', marginBottom: 14 },
  reportSubmitBtn: { backgroundColor: colors.tealGreen, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  reportSubmitBtnDisabled: { opacity: 0.4 },
  reportSubmitText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  reportSuccessWrap: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  reportSuccessIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#F0FDFB', alignItems: 'center', justifyContent: 'center' },
  reportSuccessTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack },
  reportSuccessSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center' },

  // ── Block Modal ───────────────────────────────────────────────────────────────
  blockOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 24 },
  blockSheet: { backgroundColor: colors.mistWhite, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center', gap: 12, width: '100%', ...shadow('#000', 0, 8, 24, 0.15, 12) },
  blockIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  blockTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, textAlign: 'center' },
  blockSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },
  blockConfirmBtn: { backgroundColor: colors.error, borderRadius: 14, paddingVertical: 14, alignItems: 'center', width: '100%', marginTop: 4 },
  blockConfirmText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  blockCancelBtn: { backgroundColor: colors.cloudGrey, borderRadius: 14, paddingVertical: 14, alignItems: 'center', width: '100%' },
  blockCancelText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },

  // ── Blocked state ─────────────────────────────────────────────────────────────
  blockedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FEF2F2', paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: '#FECACA' },
  blockedBannerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, flex: 1 },

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
