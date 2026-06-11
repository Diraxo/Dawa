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
import type { Channel } from 'stream-chat'
import { Chat, Channel as ChannelView, MessageComposer, MessageList } from 'stream-chat-expo'

import { EndConsultationSheet } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { streamClient } from '@/lib/stream'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DoctorChatConsultationScreen() {
  const { channelId, patientName } = useLocalSearchParams<{ channelId?: string; patientName?: string }>()
  const router = useRouter()
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [ended, setEnded] = useState(false)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [channelLoading, setChannelLoading] = useState(false)

  const displayName = patientName ?? 'Patient'

  // Watch the Stream channel so messages load
  useEffect(() => {
    if (!channelId) return
    let mounted = true
    setChannelLoading(true)
    const ch = streamClient.channel('messaging', channelId)
    ch.watch()
      .then(() => { if (mounted) setActiveChannel(ch) })
      .catch((err) => console.error('[DoctorChat] channel watch failed:', err))
      .finally(() => { if (mounted) setChannelLoading(false) })
    return () => {
      mounted = false
      ch.stopWatching()
      setActiveChannel(null)
    }
  }, [channelId])

  const handleEndSubmit = () => {
    setShowEndSheet(false)
    setEnded(true)
    // TODO: POST summary to Supabase, send FCM push to patient
  }

  if (!channelId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.headerTitle}>{displayName}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.noChannelWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
          <Text style={styles.noChannelText}>Connecting to consultation...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId=""
          patientName={displayName}
          onSubmit={handleEndSubmit}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
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
                {ended ? 'Consultation ended' : 'Active session'}
              </Text>
            </View>
          </View>
        </View>
        {!ended ? (
          <Pressable
            onPress={() => setShowEndSheet(true)}
            style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.endBtnText}>End</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.replace('/(doctor)/(tabs)/consultations')}
            style={({ pressed }) => [styles.backToListBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.backToListText}>Done</Text>
          </Pressable>
        )}
      </View>

      {ended && (
        <View style={styles.endedBanner}>
          <Ionicons name="lock-closed-outline" size={13} color="#6B7280" />
          <Text style={styles.endedText}>Consultation ended · Chat is read-only</Text>
        </View>
      )}

      {/* Chat area */}
      {channelLoading || !activeChannel ? (
        <View style={styles.noChannelWrap}>
          <ActivityIndicator color={colors.careBlue} size="large" />
          <Text style={styles.noChannelText}>
            {channelId ? 'Connecting to consultation...' : 'Waiting for channel connection...'}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.mistWhite, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
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

