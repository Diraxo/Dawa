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
        size={danger ? 28 : 24}
        color={danger ? colors.mistWhite : active ? colors.tealGreen : 'rgba(255,255,255,0.85)'}
      />
      <Text style={[styles.ctrlLabel, active && { color: colors.tealGreen }]}>{label}</Text>
    </Pressable>
  )
}

export default function PatientPhoneConsultationScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { consultationId, doctorId, doctorName } = useLocalSearchParams<{
    consultationId: string; doctorId: string; doctorName: string
  }>()

  const [isMuted, setIsMuted] = useState(false)
  const [isSpeaker, setIsSpeaker] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [duration, setDuration] = useState(0)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [activeChannel, setActiveChannel] = useState<any>(null)
  const [channelLoading, setChannelLoading] = useState(false)

  const chatSlide = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(1)).current
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)

  // Agora audio call
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
            if (mounted) setCallStatus('waiting')
          },
          onUserJoined: () => {
            if (mounted) {
              setCallStatus('connected')
              timerRef.current = setInterval(() => {
                setDuration(d => { durationRef.current = d + 1; return d + 1 })
              }, 1000)
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
            if (mounted) setCallStatus('waiting')
          },
          onError: (err: any) => {
            logger.error('[Agora] Phone error:', err)
            if (mounted) setCallStatus('error')
          },
        })

        engine.enableAudio()
        engine.setEnableSpeakerphone(isSpeaker)

        await engine.joinChannel(agoraToken, consultationId, uid, {
          channelProfile: ChannelProfileType.ChannelProfileCommunication,
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        })
      } catch (err) {
        logger.error('[Agora] Phone join failed:', err)
        if (mounted) setCallStatus('error')
      }
    })()

    return () => {
      mounted = false
      if (timerRef.current) clearInterval(timerRef.current)
      const engine = getAgoraEngine()
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, user])

  // Sync mute
  useEffect(() => {
    try { getAgoraEngine()?.muteLocalAudioStream(isMuted) } catch {}
  }, [isMuted])

  // Sync speaker
  useEffect(() => {
    try { getAgoraEngine()?.setEnableSpeakerphone(isSpeaker) } catch {}
  }, [isSpeaker])

  // Avatar pulse animation
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  const openChat = () => {
    if (!activeChannel && consultationId && Chat) {
      setChannelLoading(true)
      const ch = streamClient.channel('messaging', consultationId)
      ch.watch()
        .then(() => setActiveChannel(ch))
        .catch(err => logger.error('[PhoneChat] watch failed:', err))
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
      'Leave Call',
      'The doctor will continue the session. You can rejoin from your Messages tab.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: () => {
            if (timerRef.current) clearInterval(timerRef.current)
            try { getAgoraEngine()?.leaveChannel() } catch {}
            releaseAgoraEngine()
            router.replace('/(patient)/(tabs)/appointments' as any)
          },
        },
      ],
    )
  }

  const chatTranslateY = chatSlide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] })

  const statusLabel: Record<CallStatus, string> = {
    connecting: 'Connecting…',
    waiting: 'Waiting for doctor…',
    connected: 'In call',
    error: 'Connection failed',
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <View style={styles.badge}>
            <Ionicons name="call" size={13} color={colors.tealGreen} />
            <Text style={styles.badgeText}>Phone Call</Text>
          </View>
          <Text style={styles.timerText}>{formatDuration(duration)}</Text>
        </View>

        {/* Avatar + name */}
        <View style={styles.center}>
          <Animated.View style={[styles.avatarWrap, { transform: [{ scale: pulse }] }]}>
            <View style={styles.avatarRing} />
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={56} color="rgba(255,255,255,0.5)" />
            </View>
          </Animated.View>
          <Text style={styles.name}>{doctorName ?? 'Doctor'}</Text>
          <Text style={[
            styles.callStatus,
            callStatus === 'connected' && { color: colors.tealGreen },
            callStatus === 'error' && { color: colors.error },
          ]}>
            {statusLabel[callStatus]}
          </Text>
          {callStatus === 'error' && (
            <Text style={styles.errorHint}>Check your microphone permissions and try again.</Text>
          )}
          {callStatus === 'connected' && (
            <Text style={styles.chatHint}>Tap Chat to send images or notes during the call</Text>
          )}
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <CtrlBtn icon={isMuted ? 'mic-off' : 'mic'} label={isMuted ? 'Unmute' : 'Mute'} active={isMuted} onPress={() => setIsMuted(m => !m)} />
          <CtrlBtn icon="volume-high" label="Speaker" active={isSpeaker} onPress={() => setIsSpeaker(s => !s)} />
          <CtrlBtn icon="chatbubble-ellipses" label="Chat" active={chatOpen} onPress={chatOpen ? closeChat : openChat} />
          <CtrlBtn icon="call" label="Leave" danger onPress={handleEnd} />
        </View>
      </SafeAreaView>

      {/* Slide-up chat panel */}
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

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,191,165,0.15)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },
  timerText: { fontFamily: fonts.bold, fontSize: 16, color: 'rgba(255,255,255,0.7)' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarRing: {
    position: 'absolute', width: 155, height: 155, borderRadius: 78,
    borderWidth: 1.5, borderColor: 'rgba(0,191,165,0.25)',
  },
  avatarCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
  },
  name: { fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite },
  callStatus: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  errorHint: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(211,47,47,0.7)', textAlign: 'center' },
  chatHint: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 8 },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8,
  },
  ctrlBtn: {
    alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', minWidth: 68,
  },
  ctrlBtnActive: { backgroundColor: 'rgba(0,191,165,0.12)' },
  ctrlBtnDanger: {
    backgroundColor: colors.error, width: 72, height: 72,
    borderRadius: 36, paddingVertical: 0,
  },
  ctrlLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  chatPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '62%',
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
