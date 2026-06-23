import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { EndConsultationSheet, type ConsultationSummaryData } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { streamClient, markConsultationCompleted } from '@/lib/stream'
import { getAuthClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// Lazy-load Stream Chat and react-native-agora video view
let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
let RtcSurfaceView: any = null
let VideoSourceType: any = null
try {
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
} catch {}
try {
  const rna = require('react-native-agora')
  RtcSurfaceView = rna.RtcSurfaceView
  VideoSourceType = rna.VideoSourceType
} catch {}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'error'

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function CtrlBtn({
  icon, label, active = false, danger = false, onPress,
}: {
  icon: string; label: string; active?: boolean; danger?: boolean; onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.ctrlBtn,
        active && styles.ctrlBtnActive,
        danger && styles.ctrlBtnDanger,
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon as any}
        size={danger ? 28 : 22}
        color={danger ? colors.mistWhite : active ? colors.tealGreen : 'rgba(255,255,255,0.9)'}
      />
      <Text style={[styles.ctrlLabel, active && { color: colors.tealGreen }]}>{label}</Text>
    </Pressable>
  )
}

export default function DoctorVideoConsultationScreen() {
  const router = useRouter()
  const { consultationId, patientName } = useLocalSearchParams<{
    consultationId: string; patientName: string
  }>()
  const { getToken } = useAuth()
  const { user } = useUser()

  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [duration, setDuration] = useState(0)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)

  const chatSlide = useRef(new Animated.Value(0)).current
  const engineRef = useRef<any>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Agora video call
  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_AGORA_APP_ID
    if (!appId || !consultationId || !user) return
    let mounted = true

    async function joinCall() {
      try {
        const clerkToken = await getToken()
        if (!clerkToken || !mounted) return

        const uid = uidFromString(user!.id)
        const channelName = consultationId as string

        const engine = getAgoraEngine()
        engineRef.current = engine

        const { ClientRoleType } = require('react-native-agora')

        engine.registerEventHandler({
          onJoinChannelSuccess: () => {
            if (mounted) setCallStatus('waiting')
          },
          onUserJoined: (_connection: any, rUid: number) => {
            if (mounted) {
              setRemoteUid(rUid)
              setCallStatus('connected')
              if (!timerRef.current) {
                timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
              }
              // Mark consultation in_progress once both parties are connected
              getToken().then(tok => {
                if (!tok || !consultationId) return
                getAuthClient(tok)
                  .from('consultations')
                  .update({ status: 'in_progress' })
                  .eq('id', consultationId)
                  .in('status', ['accepted', 'active'])
                  .then(() => {})
              })
            }
          },
          onUserOffline: () => {
            if (mounted) { setRemoteUid(null); setCallStatus('waiting') }
          },
          onError: (err: any) => {
            logger.error('[Agora] Video call error:', err)
            if (mounted) setCallStatus('error')
          },
        })

        engine.enableVideo()
        engine.enableAudio()
        engine.startPreview()

        const agoraToken = await fetchAgoraToken(channelName, uid, clerkToken)
        if (!mounted) return

        await engine.joinChannel(agoraToken, channelName, uid, {
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: true,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        })
      } catch (err) {
        logger.error('[Agora] Doctor video join error:', err)
        if (mounted) setCallStatus('error')
      }
    }

    joinCall()

    return () => {
      mounted = false
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      try {
        engineRef.current?.leaveChannel()
        engineRef.current?.stopPreview()
        releaseAgoraEngine()
        engineRef.current = null
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, user])

  // Sync mute
  useEffect(() => {
    try { engineRef.current?.muteLocalAudioStream(isMuted) } catch {}
  }, [isMuted])

  // Sync camera — enableLocalVideo(false) stops capture, muteLocalVideoStream only hides it
  useEffect(() => {
    try { engineRef.current?.enableLocalVideo(!isCameraOff) } catch {}
  }, [isCameraOff])

  const openChat = () => {
    if (!activeChannel && consultationId && Chat) {
      setChannelLoading(true)
      const ch = streamClient.channel('messaging', consultationId)
      ch.watch()
        .then(() => setActiveChannel(ch))
        .catch(err => logger.error('[DoctorVideoChat] watch failed:', err))
        .finally(() => setChannelLoading(false))
    }
    Animated.spring(chatSlide, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start()
    setChatOpen(true)
  }

  const closeChat = () => {
    Animated.timing(chatSlide, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
      setChatOpen(false)
    )
  }

  const handleEndSubmit = async (data: ConsultationSummaryData) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (token && consultationId) {
        const client = getAuthClient(token)
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
          .update({ status: 'completed', ended_at: new Date().toISOString(), duration_minutes: Math.ceil(duration / 60) })
          .eq('id', consultationId)
        try { await markConsultationCompleted(consultationId) } catch (e) { logger.error('[Stream] markCompleted failed:', e) }
      }
    } catch (err) {
      logger.error('[DoctorVideo] failed to save summary:', err)
    } finally {
      setSubmitting(false)
    }
    try { engineRef.current?.leaveChannel(); engineRef.current?.stopPreview(); releaseAgoraEngine(); engineRef.current = null } catch {}
    setShowEndSheet(false)
    router.replace('/(doctor)/(tabs)/home' as any)
  }

  const handleEnd = () => {
    Alert.alert('End Video Call', 'End this video consultation?', [
      { text: 'Stay', style: 'cancel' },
      { text: 'End Call', style: 'destructive', onPress: () => setShowEndSheet(true) },
    ])
  }

  const chatTranslateY = chatSlide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] })
  const myUid = user ? uidFromString(user.id) : 0

  return (
    <View style={styles.root}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={patientName ?? 'Patient'}
          onSubmit={handleEndSubmit}
          onClose={() => !submitting && setShowEndSheet(false)}
        />
      )}

      {/* ── Video feed area ── */}
      <View style={styles.videoArea}>
        {/* Remote video — patient */}
        {RtcSurfaceView && remoteUid !== null ? (
          <RtcSurfaceView
            style={styles.remoteVideo}
            canvas={{ uid: remoteUid, sourceType: VideoSourceType?.VideoSourceRemote }}
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <View style={styles.patientAvatarCircle}>
              <Ionicons name="person" size={52} color="rgba(255,255,255,0.3)" />
            </View>
            <Text style={styles.videoStatusText}>
              {callStatus === 'connecting' ? 'Connecting…' :
               callStatus === 'error' ? 'Connection failed' :
               callStatus === 'waiting' ? 'Waiting for patient…' : ''}
            </Text>
            <Text style={styles.videoPatientName}>{patientName ?? 'Patient'}</Text>
          </View>
        )}

        {/* Self-view bubble — local video */}
        <View style={styles.selfView}>
          {RtcSurfaceView && !isCameraOff ? (
            <RtcSurfaceView
              style={StyleSheet.absoluteFillObject}
              canvas={{ uid: myUid, sourceType: VideoSourceType?.VideoSourceCamera }}
            />
          ) : (
            <View style={styles.selfViewFallback}>
              <Ionicons name={isCameraOff ? 'videocam-off' : 'person'} size={20} color="rgba(255,255,255,0.5)" />
            </View>
          )}
          <Text style={styles.selfLabel}>You</Text>
        </View>

        {/* Overlay header */}
        <SafeAreaView style={styles.videoOverlay} edges={['top']}>
          <View style={styles.overlayRow}>
            <View style={styles.badge}>
              <Ionicons name="videocam" size={13} color="#7C3AED" />
              <Text style={[styles.badgeText, { color: '#7C3AED' }]}>Video Call</Text>
            </View>
            <Text style={styles.timerText}>{formatDuration(duration)}</Text>
          </View>
          <Text style={styles.patientNameOverlay}>{patientName ?? 'Patient'}</Text>
        </SafeAreaView>
      </View>

      {/* ── Controls bar ── */}
      <SafeAreaView style={styles.controls} edges={['bottom']}>
        <CtrlBtn icon={isMuted ? 'mic-off' : 'mic'} label={isMuted ? 'Unmute' : 'Mute'} active={isMuted} onPress={() => setIsMuted(m => !m)} />
        <CtrlBtn icon={isCameraOff ? 'videocam-off' : 'videocam'} label={isCameraOff ? 'Cam On' : 'Camera'} active={isCameraOff} onPress={() => setIsCameraOff(c => !c)} />
        <CtrlBtn icon="chatbubble-ellipses" label="Chat" active={chatOpen} onPress={chatOpen ? closeChat : openChat} />
        <CtrlBtn icon="call" label="End" danger onPress={handleEnd} />
      </SafeAreaView>

      {/* ── Slide-up chat panel ── */}
      {chatOpen && (
        <Animated.View style={[styles.chatPanel, { transform: [{ translateY: chatTranslateY }] }]}>
          <View style={styles.panelHandle} />
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Chat — share notes or images</Text>
            <Pressable onPress={closeChat} hitSlop={12}>
              <Ionicons name="chevron-down" size={22} color={colors.inkBlack} />
            </Pressable>
          </View>
          {!Chat ? (
            <View style={styles.panelEmpty}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.steelGrey} />
              <Text style={styles.panelEmptyText}>Chat not available in Expo Go</Text>
              <Text style={styles.panelEmptyHint}>Use a development build to enable chat</Text>
            </View>
          ) : channelLoading || !activeChannel ? (
            <View style={styles.panelEmpty}>
              <ActivityIndicator color={colors.careBlue} size="large" />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Chat client={streamClient}>
                <ChannelView channel={activeChannel}>
                  <MessageList />
                  <MessageComposer />
                </ChannelView>
              </Chat>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070E27' },

  videoArea: { flex: 1, position: 'relative', backgroundColor: '#000' },
  remoteVideo: { flex: 1 },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  patientAvatarCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
  },
  videoStatusText: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  videoPatientName: { fontFamily: fonts.semiBold, fontSize: 18, color: 'rgba(255,255,255,0.7)' },

  selfView: {
    position: 'absolute', top: 90, right: 16,
    width: 80, height: 110, borderRadius: 14,
    backgroundColor: '#1A2744', overflow: 'hidden',
    borderWidth: 2, borderColor: colors.tealGreen,
  },
  selfViewFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  selfLabel: {
    position: 'absolute', bottom: 4, left: 0, right: 0,
    textAlign: 'center', fontFamily: fonts.regular,
    fontSize: 9, color: 'rgba(255,255,255,0.6)',
  },

  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  overlayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 13 },
  timerText: { fontFamily: fonts.bold, fontSize: 16, color: 'rgba(255,255,255,0.8)' },
  patientNameOverlay: {
    fontFamily: fonts.semiBold, fontSize: 16, color: 'rgba(255,255,255,0.85)', paddingBottom: 8,
  },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(7,14,39,0.95)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  ctrlBtn: {
    alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10,
    borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', minWidth: 64,
  },
  ctrlBtnActive: { backgroundColor: 'rgba(0,191,165,0.12)' },
  ctrlBtnDanger: {
    backgroundColor: colors.error, width: 68, height: 68,
    borderRadius: 34, paddingVertical: 0,
  },
  ctrlLabel: { fontFamily: fonts.regular, fontSize: 10, color: 'rgba(255,255,255,0.7)' },

  chatPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%',
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 8, elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35, shadowRadius: 14,
  },
  panelHandle: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: colors.steelGrey,
    alignSelf: 'center', marginBottom: 8,
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  panelTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  panelEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  panelEmptyText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  panelEmptyHint: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF' },
})
