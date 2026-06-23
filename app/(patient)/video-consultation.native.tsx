import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ScreenCapture from 'expo-screen-capture'

// Hardcoded to avoid requiring the native module at load time (TurboModule Proxy crashes at startup)
const ClientRoleBroadcaster = 1  // ClientRoleType.ClientRoleBroadcaster
const VideoSourceCamera = 0       // VideoSourceType.VideoSourceCamera
let RtcSurfaceView: any = null

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'

export default function VideoConsultationScreen() {
  const { doctorId, doctorName, consultationId } = useLocalSearchParams<{
    doctorId?: string
    doctorName?: string
    consultationId?: string
  }>()

  // Prevent screenshots and screen recording during video calls
  ScreenCapture.usePreventScreenCapture()
  const router = useRouter()
  const { userId } = useAuthStore()
  const { getToken } = useAuth()

  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [selfViewHidden, setSelfViewHidden] = useState(false)
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  const [joined, setJoined] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)

  const channelName = consultationId ?? `consult-${doctorId ?? 'demo'}`
  const localUid = useMemo(() => userId ? uidFromString(userId) : 1, [userId])
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null
  const remoteUidRef = useRef<number | null>(null)

  // Fetch Agora token
  useEffect(() => {
    if (!channelName) return
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(setAgoraToken)
        .catch((err) => logger.error('[Agora] Token fetch failed:', err))
    })
  }, [channelName, localUid, getToken])

  // Timer
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Agora engine — video call
  useEffect(() => {
    if (!agoraReady) return

    let mounted = true
    let engine: ReturnType<typeof getAgoraEngine> | null = null

    try {
      engine = getAgoraEngine()
    } catch {
      return
    }

    const handler = {
      onJoinChannelSuccess: () => {
        if (mounted) setJoined(true)
      },
      onUserJoined: (_conn, uid) => {
        if (!mounted) return
        remoteUidRef.current = uid
        setRemoteUid(uid)
      },
      onUserOffline: (_conn, uid) => {
        if (!mounted) return
        if (uid === remoteUidRef.current) {
          remoteUidRef.current = null
          setRemoteUid(null)
        }
      },
    }

    engine.registerEventHandler(handler)
    engine.enableAudio()
    engine.enableVideo()
    engine.startPreview()
    engine.joinChannel(agoraToken ?? '', channelName, localUid, {
      clientRoleType: ClientRoleBroadcaster,
    })

    return () => {
      mounted = false
      engine?.unregisterEventHandler(handler)
      engine?.stopPreview()
      engine?.leaveChannel()
      releaseAgoraEngine()
    }
  }, [agoraReady, channelName, localUid])

  // Sync mute
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalAudioStream(muted) } catch {}
  }, [muted, agoraReady])

  // Sync camera
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().muteLocalVideoStream(cameraOff) } catch {}
  }, [cameraOff, agoraReady])

  const handleSwitchCamera = () => {
    if (!agoraReady) return
    try { getAgoraEngine().switchCamera() } catch {}
  }

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleEnd = () => {
    Alert.alert('End Call', 'Are you sure you want to end this video call?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Call',
        style: 'destructive',
        onPress: () =>
          router.replace({
            pathname: '/(patient)/consultation-summary',
            params: { doctorId, doctorName, consultationType: 'video' },
          }),
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* Remote video (full screen) */}
      <View style={styles.mainVideo}>
        {agoraReady && remoteUid && RtcSurfaceView ? (
          <RtcSurfaceView
            canvas={{ uid: remoteUid }}
            style={styles.fullFill}
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="person" size={72} color="rgba(255,255,255,0.2)" />
            <Text style={styles.videoPlaceholderText}>{doctorName ?? 'Doctor'}</Text>
            <Text style={styles.videoNote}>
              {joined ? 'Waiting for doctor to join...' : 'Connecting...'}
            </Text>
          </View>
        )}

        {/* Top overlay: LIVE + timer */}
        <View style={styles.topOverlay}>
          <View style={styles.liveChip}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.timerOverlay}>{formatTime(seconds)}</Text>
        </View>

        {/* Self view (patient) — bottom right */}
        {!selfViewHidden && (
          <Pressable style={styles.selfView} onPress={() => setSelfViewHidden(true)}>
            {agoraReady && !cameraOff && RtcSurfaceView ? (
              <RtcSurfaceView
                canvas={{ uid: 0, sourceType: VideoSourceCamera }}
                style={styles.fullFill}
              />
            ) : (
              <View style={styles.selfViewOff}>
                <Ionicons
                  name={cameraOff ? 'videocam-off' : 'person'}
                  size={22}
                  color="rgba(255,255,255,0.5)"
                />
              </View>
            )}
            <Text style={styles.selfLabel}>You</Text>
          </Pressable>
        )}

        {selfViewHidden && (
          <Pressable style={styles.showSelfBtn} onPress={() => setSelfViewHidden(false)}>
            <Text style={styles.showSelfText}>Show self view</Text>
          </Pressable>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <ControlButton
            icon={muted ? 'mic-off' : 'mic'}
            label={muted ? 'Unmute' : 'Mute'}
            active={muted}
            onPress={() => setMuted(m => !m)}
          />
          <ControlButton
            icon={cameraOff ? 'videocam-off' : 'videocam'}
            label={cameraOff ? 'Camera Off' : 'Camera'}
            active={cameraOff}
            onPress={() => setCameraOff(c => !c)}
          />
          <ControlButton
            icon="camera-reverse"
            label="Switch"
            onPress={handleSwitchCamera}
          />
          <Pressable style={styles.endBtn} onPress={handleEnd}>
            <Ionicons
              name="call"
              size={28}
              color={colors.mistWhite}
              style={{ transform: [{ rotate: '135deg' }] }}
            />
            <Text style={styles.endLabel}>End</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

function ControlButton({
  icon, label, active, onPress,
}: {
  icon: string; label: string; active?: boolean; onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.ctrlBtn, active && styles.ctrlBtnActive, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={24} color={active ? colors.mistWhite : 'rgba(255,255,255,0.85)'} />
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  fullFill: { flex: 1 },

  mainVideo: { flex: 1, position: 'relative' },
  videoPlaceholder: {
    flex: 1, backgroundColor: '#111827',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  videoPlaceholderText: { fontFamily: fonts.bold, fontSize: 22, color: 'rgba(255,255,255,0.6)' },
  videoNote: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.3)' },

  topOverlay: {
    position: 'absolute', top: 50, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveText: { fontFamily: fonts.bold, fontSize: 12, color: colors.mistWhite, letterSpacing: 1 },
  timerOverlay: {
    fontFamily: fonts.medium, fontSize: 16, color: colors.mistWhite,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },

  selfView: {
    position: 'absolute', bottom: 20, right: 20,
    width: 90, height: 120, borderRadius: 14,
    overflow: 'hidden', borderWidth: 2, borderColor: colors.mistWhite,
    alignItems: 'center', justifyContent: 'flex-end',
  },
  selfViewOff: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#1F2937',
    alignItems: 'center', justifyContent: 'center',
  },
  selfLabel: {
    fontFamily: fonts.medium, fontSize: 10, color: colors.mistWhite,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8, paddingVertical: 4, width: '100%', textAlign: 'center',
  },
  showSelfBtn: {
    position: 'absolute', bottom: 20, right: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  showSelfText: { fontFamily: fonts.medium, fontSize: 11, color: colors.mistWhite },

  controls: {
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  ctrlBtn: {
    alignItems: 'center', gap: 6,
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
  },
  ctrlBtnActive: { backgroundColor: '#374151' },
  ctrlLabel: { fontFamily: fonts.medium, fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  endBtn: {
    alignItems: 'center', gap: 6,
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: colors.error, justifyContent: 'center',
    shadowColor: colors.error, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
  },
  endLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.mistWhite },
})
