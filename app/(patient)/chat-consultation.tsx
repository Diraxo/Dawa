import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
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
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
} catch {}

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { streamClient } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuth } from '@clerk/clerk-expo'
import { logger } from '@/lib/logger'

// ─── Types ────────────────────────────────────────────────────────────────────

// 'countdown' — appointment not yet reached, chat locked
// 'waiting'   — time passed, waiting for doctor to start
// 'active'    — live session, Stream Chat handles messages
// 'completed' — session ended, read-only
type ConsultationState = 'countdown' | 'waiting' | 'active' | 'completed'

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
  const { t } = useTranslation()
  const { getToken } = useAuth()

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

  // ── Waiting → active via Supabase Realtime ────────────────────────────────

  useEffect(() => {
    if (consultationState !== 'waiting' || !channelId) return
    const sub = supabase
      .channel(`patient-chat-status-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${channelId}` },
        (payload) => {
          const status = (payload.new as { status: string }).status
          if (status === 'accepted' || status === 'in_progress' || status === 'active') {
            setConsultationState('active')
          } else if (status === 'completed' || status === 'declined' || status === 'cancelled') {
            setConsultationState('completed')
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [consultationState, channelId])

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

    let mounted = true
    setChannelLoading(true)

    const ch = streamClient.channel('messaging', channelId)
    ch.watch()
      .then(() => {
        if (mounted) setActiveChannel(ch)
      })
      .catch((err) => logger.error('[Chat] channel watch failed:', err))
      .finally(() => {
        if (mounted) setChannelLoading(false)
      })

    return () => {
      mounted = false
      ch.stopWatching().catch(() => {})
      setActiveChannel(null)
    }
  }, [channelId, consultationState])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (consultationState === 'active') {
      // Leave the chat but keep the consultation active.
      // The conversation stays in the Messages tab — the patient can return to it anytime.
      Alert.alert(t('leaveConsultation'), t('leaveConsultationMsg'), [
        { text: t('stay'), style: 'cancel' },
        {
          text: t('leave'),
          style: 'destructive',
          onPress: () => router.replace('/(patient)/(tabs)/messages' as never),
        },
      ])
    } else {
      router.canGoBack() ? router.back() : router.replace('/(patient)/(tabs)/messages' as never)
    }
  }

  const handleLeaveConsultation = () => {
    Alert.alert(
      t('leaveConsultation'),
      'You can return to this consultation from the Messages tab at any time. The doctor will continue the session.',
      [
        { text: t('stay'), style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => router.replace('/(patient)/(tabs)/messages' as never),
        },
      ],
    )
  }

  // ── Countdown screen ───────────────────────────────────────────────────────

  if (consultationState === 'countdown') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerDoctorName} numberOfLines={1}>
              {doctorName ?? 'Doctor'}
            </Text>
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
            <Text style={styles.headerDoctorName} numberOfLines={1}>
              {doctorName ?? 'Doctor'}
            </Text>
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

  const isCompleted = consultationState === 'completed'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
        </Pressable>

        <View style={styles.doctorInfo}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={18} color={colors.steelGrey} />
            </View>
            {!isCompleted && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerDoctorName} numberOfLines={1}>
              {doctorName ?? 'Doctor'}
            </Text>
            <View style={styles.statusRow}>
              {!isCompleted && <View style={styles.liveDot} />}
              <Text
                style={[
                  styles.headerSub,
                  { color: isCompleted ? '#9CA3AF' : colors.success },
                ]}
              >
                {isCompleted ? t('consultationEnded') : t('online')}
              </Text>
            </View>
          </View>
        </View>

        {!isCompleted ? (
          <Pressable
            onPress={handleLeaveConsultation}
            style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.endBtnText}>Leave</Text>
          </Pressable>
        ) : (
          <View style={styles.headerPlaceholder} />
        )}
      </View>

      {/* ── Ended banner ── */}
      {isCompleted && (
        <View style={styles.endedBanner}>
          <Ionicons name="lock-closed-outline" size={13} color="#6B7280" />
          <Text style={styles.endedBannerText}>{t('consultationEndedBanner')}</Text>
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
      ) : channelLoading || !activeChannel ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
        </View>
      ) : (
        <View style={styles.chatArea}>
          <Chat client={streamClient}>
            <ChannelView channel={activeChannel}>
              <MessageList />
              {!isCompleted && <MessageComposer />}
            </ChannelView>
          </Chat>
        </View>
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.mistWhite,
    borderBottomWidth: 1,
    borderBottomColor: colors.cloudGrey,
    ...shadow('#000', 0, 1, 4, 0.06, 2),
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerPlaceholder: { width: 36 },
  headerDoctorName: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.inkBlack,
  },
  headerSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },

  doctorInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerTextWrap: { flex: 1 },
  avatarWrap: { position: 'relative', width: 38, height: 38 },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.mistWhite,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  endBtn: {
    backgroundColor: colors.error,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  endBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },

  endedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: colors.cloudGrey,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  endedBannerText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
  },

  chatArea: { flex: 1 },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  noChannelTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  noChannelSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },

  // ── Lock / countdown / waiting ─────────────────────────────────────────────
  lockBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  lockIconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  lockIconCircleTeal: { backgroundColor: '#F0FDFB' },
  lockTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  lockSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
  countdownBox: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 18,
    ...shadow(colors.careBlue, 0, 4, 12, 0.12, 3),
    marginVertical: 4,
  },
  countdownText: {
    fontFamily: fonts.bold,
    fontSize: 44,
    color: colors.careBlue,
    letterSpacing: 4,
  },
  lockNote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
  },
  dotsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.tealGreen },
  dot1: { opacity: 1 },
  dot2: { opacity: 0.6 },
  dot3: { opacity: 0.3 },
})
