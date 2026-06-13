import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@clerk/clerk-expo'
import {
  ClientRoleType,
  IRtcEngineEventHandler,
} from 'react-native-agora'
import * as ScreenCapture from 'expo-screen-capture'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { useAuthStore } from '@/store/authStore'

type CallStatus = 'connecting' | 'waiting' | 'connected'

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting...',
  waiting: 'Waiting for doctor...',
  connected: 'On Call',
}

export default function PhoneConsultationScreen() {
  const { doctorId, doctorName, consultationId } = useLocalSearchParams<{
    doctorId?: string
    doctorName?: string
    consultationId?: string
  }>()
  const router = useRouter()
  const { userId } = useAuthStore()
  const { getToken } = useAuth()

  // Prevent screenshots and screen recording during calls
  ScreenCapture.usePreventScreenCapture()

  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(false)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [agoraToken, setAgoraToken] = useState<string | null>(null)

  const channelName = consultationId ?? `consult-${doctorId ?? 'demo'}`
  const localUid = useMemo(() => userId ? uidFromString(userId) : 1, [userId])
  const remoteUidRef = useRef<number | null>(null)
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null

  // Fetch Agora token
  useEffect(() => {
    if (!channelName) return
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(setAgoraToken)
        .catch(console.error)
    })
  }, [channelName, localUid, getToken])

  // Timer
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Agora engine — audio call
  useEffect(() => {
    if (!agoraReady) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try {
      engine = getAgoraEngine()
    } catch {
      return
    }

    const handler: IRtcEngineEventHandler = {
      onJoinChannelSuccess: () => {
        if (mounted) setCallStatus('waiting')
      },
      onUserJoined: (_conn, uid) => {
        if (!mounted) return
        remoteUidRef.current = uid
        setCallStatus('connected')
      },
      onUserOffline: (_conn, uid) => {
        if (!mounted) return
        if (uid === remoteUidRef.current) {
          remoteUidRef.current = null
          setCallStatus('waiting')
        }
      },
    }

    engine.registerEventHandler(handler)
    engine.enableAudio()
    engine.disableVideo()
    engine.setEnableSpeakerphone(false)
    engine.joinChannel(agoraToken ?? '', channelName, localUid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    })

    return () => {
      mounted = false
      engine?.unregisterEventHandler(handler)
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  }, [agoraReady, channelName, localUid])

  // Sync mute
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalAudioStream(muted) } catch {}
  }, [muted, agoraReady])

  // Sync speaker
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().setEnableSpeakerphone(speakerOn) } catch {}
  }, [speakerOn, agoraReady])

  // Pulse animation
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleEnd = () => {
    Alert.alert('End Call', 'Are you sure you want to end this call?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Call',
        style: 'destructive',
        onPress: () =>
          router.replace({
            pathname: '/(patient)/consultation-summary',
            params: { doctorId, doctorName, consultationType: 'phone' },
          }),
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topSection}>
        <Text style={styles.callLabel}>{STATUS_LABEL[callStatus]}</Text>

        <Animated.View style={[styles.photoCircle, { transform: [{ scale: pulse }] }]}>
          <Ionicons name="person" size={56} color="rgba(255,255,255,0.4)" />
        </Animated.View>

        <Text style={styles.doctorName}>{doctorName ?? 'Doctor'}</Text>
        <Text style={styles.timer}>{formatTime(seconds)}</Text>

        {/* Sound wave indicator */}
        <View style={styles.waveRow}>
          {[4, 8, 6, 12, 8, 5, 10, 7, 4, 9, 6, 3].map((h, i) => (
            <View
              key={i}
              style={[styles.waveLine, { height: muted ? 3 : h, opacity: muted ? 0.25 : 0.8 }]}
            />
          ))}
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <Pressable
            style={[styles.controlBtn, muted && styles.controlBtnActive]}
            onPress={() => setMuted(m => !m)}
          >
            <Ionicons
              name={muted ? 'mic-off' : 'mic'}
              size={26}
              color={muted ? colors.mistWhite : colors.inkBlack}
            />
            <Text style={[styles.controlLabel, muted && styles.controlLabelActive]}>
              {muted ? 'Unmute' : 'Mute'}
            </Text>
          </Pressable>

          <Pressable style={styles.endBtn} onPress={handleEnd}>
            <Ionicons name="call" size={30} color={colors.mistWhite} />
          </Pressable>

          <Pressable
            style={[styles.controlBtn, speakerOn && styles.controlBtnActive]}
            onPress={() => setSpeakerOn(s => !s)}
          >
            <Ionicons
              name={speakerOn ? 'volume-high' : 'volume-medium'}
              size={26}
              color={speakerOn ? colors.mistWhite : colors.inkBlack}
            />
            <Text style={[styles.controlLabel, speakerOn && styles.controlLabelActive]}>
              Speaker
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },

  topSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  callLabel: {
    fontFamily: fonts.regular, fontSize: 14,
    color: colors.tealGreen, letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 32,
  },
  photoCircle: {
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(0,191,165,0.5)',
    marginBottom: 24,
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 8,
  },
  doctorName: {
    fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite,
    textAlign: 'center', marginBottom: 8,
  },
  timer: { fontFamily: fonts.medium, fontSize: 22, color: 'rgba(255,255,255,0.75)', marginBottom: 28 },

  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 },
  waveLine: { width: 3, borderRadius: 2, backgroundColor: colors.tealGreen },

  controls: {
    paddingHorizontal: 32, paddingBottom: 40,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingTop: 28,
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlBtn: {
    alignItems: 'center', gap: 8,
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  controlBtnActive: { backgroundColor: colors.careBlue },
  controlLabel: { fontFamily: fonts.medium, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  controlLabelActive: { color: colors.mistWhite },
  endBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.error, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
    transform: [{ rotate: '135deg' }],
  },
})
