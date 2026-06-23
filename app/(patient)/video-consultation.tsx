import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAgoraEngine, releaseAgoraEngine, fetchAgoraToken, uidFromString } from '@/lib/agora'
import { getAuthClient } from '@/lib/supabase'
import { streamClient } from '@/lib/stream'
import { logger } from '@/lib/logger'

// Lazy-load react-native-agora video views (native module not in Expo Go)
let RtcSurfaceView: any = null
let VideoSourceType: any = null
try {
  const rna = require('react-native-agora')
  RtcSurfaceView = rna.RtcSurfaceView
  VideoSourceType = rna.VideoSourceType
} catch {}

// Lazy-load Stream Chat
let Chat: any = null
let ChannelView: any = null
let MessageComposer: any = null
let MessageList: any = null
try {
  const sc = require('stream-chat-expo')
  Chat = sc.Chat
  ChannelView = sc.Channel
  MessageComposer = sc.MessageComposer
  MessageList = sc.MessageList
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

export default function PatientVideoConsultationScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { consultationId, doctorId, doctorName } = useLocalSearchParams<{
    consultationId: string; doctorId: string; doctorName: string
  }>()

  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [duration, setDuration] = useState(0)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)

  const chatSlide = useRef(new Animated.Value(0)).current
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)

  // Agora video call
  useEffect(() => {
    if (!user || !consultationId) return
    let mounted = true

    ;(async () => {
      try {
        const token = await getToken()
        if (!token || !mounted) return

        const engine = getAgoraEngine()
        const uid = uidFromString(user.id)
        const agoraToken = await fetchAgoraToken(consultationId, uid, token)
        if (!mounted) return

        const { ChannelProfileType, ClientRoleType } = require('react-native-agora')

        engine.registerEventHandler({
          onJoinChannelSuccess: () => {
            if (mounted) {
              setCallStatus('waiting')
              engine.startPreview()
            }
          },
          onUserJoined: (_connection: any, uid: number) => {
            if (mounted) {
              setRemoteUid(uid)
              setCallStatus('connected')
              timerRef.current = setInterval(() => {
                setDuration(d => { durationRef.current = d + 1; return d + 1 })
              }, 1000)
              // Mark in_progress once both parties are connected
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
            if (mounted) {
              setRemoteUid(null)
              setCallStatus('waiting')
            }
          },
          onError: (err: any) => {
            logger.error('[Agora] Video error:', err)
            if (mounted) setCallStatus('error')
          },
        })

        engine.enableVideo()
        engine.enableAudio()

        await engine.joinChannel(agoraToken, consultationId, uid, {
          channelProfile: ChannelProfileType.ChannelProfileCommunication,
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        })
      } catch (err) {
        logger.error('[Agora] Video join failed:', err)
        if (mounted) setCallStatus('error')
      }
    })()

    return () => {
      mounted = false
      if (timerRef.current) clearInterval(timerRef.current)
      try {
        const engine = getAgoraEngine()
        engine?.stopPreview()
        engine?.leaveChannel()
      } catch {}
      releaseAgoraEngine()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, user])

  // Sync mute
  useEffect(() => {
    try { getAgoraEngine()?.muteLocalAudioStream(isMuted) } catch {}
  }, [isMuted])

  // Sync camera
  useEffect(() => {
    try {
      const engine = getAgoraEngine()
      if (isCameraOff) { engine?.disableVideo() } else { engine?.enableVideo() }
    } catch {}
  }, [isCameraOff])

  const openChat = () => {
    if (!activeChannel && consultationId && Chat) {
      setChannelLoading(true)
      const ch = streamClient.channel('messaging', consultationId)
      ch.watch()
        .then(() => setActiveChannel(ch))
        .catch(err => logger.error('[VideoChat] watch failed:', err))
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

  const handleEnd = () => {
    Alert.alert(
      'Leave Video Call',
      'The doctor will continue the session. You can rejoin from your Appointments tab.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: () => {
            if (timerRef.current) clearInterval(timerRef.current)
            try {
              const engine = getAgoraEngine()
              engine?.stopPreview()
              engine?.leaveChannel()
            } catch {}
            releaseAgoraEngine()
            router.replace('/(patient)/(tabs)/appointments' as any)
          },
        },
      ],
    )
  }


  const chatTranslateY = chatSlide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] })

  return (
    <View style={styles.root}>
      {/* ── Video feed area ── */}
      <View style={styles.videoArea}>
        {/* Remote video (full screen) */}
        {RtcSurfaceView && remoteUid && callStatus === 'connected' ? (
          <RtcSurfaceView
            canvas={{ uid: remoteUid, sourceType: VideoSourceType?.VideoSourceRemote }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            {callStatus === 'connecting' || callStatus === 'waiting' ? (
              <>
                <ActivityIndicator color={colors.tealGreen} size="large" />
                <Text style={styles.videoPlaceholderText}>
                  {callStatus === 'connecting' ? 'Connecting…' : 'Waiting for doctor…'}
                </Text>
              </>
            ) : callStatus === 'error' ? (
              <Text style={[styles.videoPlaceholderText, { color: colors.error }]}>
                Could not connect. Check your camera/mic permissions.
              </Text>
            ) : null}
          </View>
        )}

        {/* Self-view bubble (local camera) */}
        <View style={styles.selfView}>
          {RtcSurfaceView && !isCameraOff ? (
            <RtcSurfaceView
              canvas={{ uid: 0 }}
              style={{ width: 80, height: 110, borderRadius: 12 }}
            />
          ) : (
            <View style={styles.selfViewOff}>
              <Ionicons name={isCameraOff ? 'videocam-off' : 'person'} size={20} color="rgba(255,255,255,0.5)" />
            </View>
          )}
        </View>

        {/* Overlay: duration + header */}
        <SafeAreaView style={styles.videoOverlay} edges={['top']}>
          <View style={styles.overlayRow}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <View style={styles.badge}>
              <Ionicons name="videocam" size={13} color="#7C3AED" />
              <Text style={[styles.badgeText, { color: '#7C3AED' }]}>Video Call</Text>
            </View>
            <Text style={styles.timerText}>{formatDuration(duration)}</Text>
          </View>
          <Text style={styles.doctorNameOverlay}>{doctorName ?? 'Doctor'}</Text>
        </SafeAreaView>
      </View>

      {/* ── Controls bar ── */}
      <SafeAreaView style={styles.controls} edges={['bottom']}>
        <CtrlBtn icon={isMuted ? 'mic-off' : 'mic'} label={isMuted ? 'Unmute' : 'Mute'} active={isMuted} onPress={() => setIsMuted(m => !m)} />
        <CtrlBtn icon={isCameraOff ? 'videocam-off' : 'videocam'} label={isCameraOff ? 'Cam On' : 'Camera'} active={isCameraOff} onPress={() => setIsCameraOff(c => !c)} />
        <CtrlBtn icon="chatbubble-ellipses" label="Chat" active={chatOpen} onPress={chatOpen ? closeChat : openChat} />
        <CtrlBtn icon="call" label="Leave" danger onPress={handleEnd} />
      </SafeAreaView>

      {/* ── Slide-up chat panel ── */}
      {chatOpen && (
        <Animated.View style={[styles.chatPanel, { transform: [{ translateY: chatTranslateY }] }]}>
          <View style={styles.panelHandle} />
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Chat — send images or notes</Text>
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
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  videoPlaceholderText: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', paddingHorizontal: 32 },

  selfView: {
    position: 'absolute', top: 90, right: 16,
    width: 80, height: 110, borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2, borderColor: colors.tealGreen,
  },
  selfViewOff: {
    flex: 1, backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
  },

  videoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 16,
  },
  overlayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 13 },
  timerText: { fontFamily: fonts.bold, fontSize: 16, color: 'rgba(255,255,255,0.8)' },
  doctorNameOverlay: {
    fontFamily: fonts.semiBold, fontSize: 16, color: 'rgba(255,255,255,0.85)',
    paddingBottom: 8,
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
