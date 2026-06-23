import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
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

import { EndConsultationSheet, type ConsultationSummaryData } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { streamClient, markConsultationCompleted } from '@/lib/stream'
import { getAuthClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DoctorChatConsultationScreen() {
  // incoming-request passes consultationId, patientName, patientId
  // channelId is the Stream channel id; falls back to consultationId
  const { channelId, consultationId, patientName } = useLocalSearchParams<{
    channelId?: string
    consultationId?: string
    patientName?: string
  }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [ended, setEnded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [channelLoading, setChannelLoading] = useState(false)

  const displayName = patientName ?? 'Patient'
  // Stream channel id = consultationId (the channel is created when consultation is booked)
  const effectiveChannelId = channelId ?? consultationId

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

  // Watch the Stream channel so messages load
  useEffect(() => {
    if (!effectiveChannelId) return
    let mounted = true
    setChannelLoading(true)
    const ch = streamClient.channel('messaging', effectiveChannelId)
    ch.watch()
      .then(() => { if (mounted) setActiveChannel(ch) })
      .catch((err) => logger.error('[DoctorChat] channel watch failed:', err))
      .finally(() => { if (mounted) setChannelLoading(false) })
    return () => {
      mounted = false
      ch.stopWatching().catch(() => {})
      setActiveChannel(null)
    }
  }, [effectiveChannelId])

  const handleEndSubmit = async (data: ConsultationSummaryData) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (token && consultationId) {
        const client = getAuthClient(token)

        // Fetch started_at to compute duration
        const { data: consult } = await client
          .from('consultations')
          .select('started_at')
          .eq('id', consultationId)
          .single()
        const endedAt = new Date().toISOString()
        const durationMinutes = consult?.started_at
          ? Math.max(1, Math.ceil((new Date(endedAt).getTime() - new Date(consult.started_at).getTime()) / 60000))
          : null

        await client.from('consultation_summaries').insert({
          consultation_id: consultationId,
          chief_complaint: data.chiefComplaint,
          diagnosis: data.diagnosis,
          prescription: data.prescriptions.length > 0
            ? JSON.stringify(data.prescriptions)
            : null,
          followup_recommendation: data.followUp || null,
          referral_needed: data.referralNeeded,
        })
        await client
          .from('consultations')
          .update({ status: 'completed', ended_at: endedAt, duration_minutes: durationMinutes })
          .eq('id', consultationId)
        try { await markConsultationCompleted(consultationId) } catch (e) { logger.error('[Stream] markCompleted failed:', e) }
        // Notify patient that the consultation summary is ready
        try {
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
          await fetch(`${supabaseUrl}/functions/v1/handle-consultation-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ event: 'summary_ready', consultation_id: consultationId }),
          })
        } catch (e) { logger.error('[Notification] summary_ready failed:', e) }
      }
    } catch (err) {
      logger.error('[DoctorChat] failed to save summary:', err)
    } finally {
      setSubmitting(false)
    }
    setShowEndSheet(false)
    setEnded(true)
  }

  if (!effectiveChannelId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/messages' as never)}
            style={styles.backBtn}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.headerTitle}>{displayName}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.noChannelWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
          <Text style={styles.noChannelText}>{t('connectingToConsultation')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => !submitting && setShowEndSheet(false)}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            // Leave the chat but keep session active — conversation stays in Messages tab
            if (!ended) {
              router.replace('/(doctor)/(tabs)/messages' as never)
            } else {
              router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/messages' as never)
            }
          }}
          style={styles.backBtn}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.patientAvatar}>
            <Text style={styles.patientAvatarText}>{displayName[0]}</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>{displayName}</Text>
            <View style={styles.statusRow}>
              {!ended && <View style={styles.liveDot} />}
              <Text style={[styles.headerStatus, ended && styles.headerStatusEnded]}>
                {ended ? t('consultationEnded') : t('activeSession')}
              </Text>
            </View>
          </View>
        </View>
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
            style={({ pressed }) => [styles.backToListBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.backToListText}>{t('done')}</Text>
          </Pressable>
        )}
      </View>

      {ended && (
        <View style={styles.endedBanner}>
          <Ionicons name="lock-closed-outline" size={13} color="#6B7280" />
          <Text style={styles.endedText}>{t('consultationEndedChatReadOnly')}</Text>
        </View>
      )}

      {/* Chat area */}
      {!Chat ? (
        <View style={styles.noChannelWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
          <Text style={styles.noChannelText}>{t('chatRequiresDevelopmentBuild')}</Text>
        </View>
      ) : channelLoading || !activeChannel ? (
        <View style={styles.noChannelWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
          <Text style={styles.noChannelText}>
            {channelId ? t('connectingToConsultation') : t('waitingForChannelConnection')}
          </Text>
        </View>
      ) : (
        <View style={styles.chatArea}>
          <Chat client={streamClient}>
            <ChannelView channel={activeChannel}>
              <MessageList />
              {!ended && <MessageComposer />}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.mistWhite, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, ...shadow('#000', 0, 1, 4, 0.06, 2) },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  patientAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center' },
  patientAvatarText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  headerStatus: { fontFamily: fonts.regular, fontSize: 12, color: colors.success },
  headerStatusEnded: { color: '#9CA3AF' },
  endBtn: { backgroundColor: colors.error, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  endBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
  backToListBtn: { backgroundColor: colors.tealGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  backToListText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
  endedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F9FAFB', borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, paddingVertical: 8 },
  endedText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  chatArea: { flex: 1 },
  noChannelWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  noChannelText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
})

