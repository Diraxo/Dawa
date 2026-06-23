import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
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

import { EndConsultationSheet } from '@/components/doctor/EndConsultationSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { fetchAgoraToken, getAgoraEngine, releaseAgoraEngine, uidFromString } from '@/lib/agora'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'

export default function DoctorVideoConsultationScreen() {
  const { patientName, consultationId } = useLocalSearchParams<{
    patientName?: string
    consultationId?: string
  }>()
  const router = useRouter()
  const { userId } = useAuthStore()
  const { getToken } = useAuth()
  const displayName = patientName ?? 'Patient'

  // Prevent screenshots and screen recording during video calls
  ScreenCapture.usePreventScreenCapture()

  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [remoteUid, setRemoteUid] = useState<number | null>(null)
  const [joined, setJoined] = useState(false)
  const [agoraToken, setAgoraToken] = useState<string | null>(null)

  const channelName = consultationId ?? `consult-demo`
  const localUid = useMemo(() => userId ? uidFromString(userId) : 2, [userId])
  const agoraReady = !!(process.env.EXPO_PUBLIC_AGORA_APP_ID) && !!channelName && agoraToken !== null
  const remoteUidRef = useRef<number | null>(null)

  // Fetch Agora token
  useEffect(() => {
    if (!channelName) return
    getToken().then(clerkToken => {
      if (!clerkToken) return
      fetchAgoraToken(channelName, localUid, clerkToken)
        .then(setAgoraToken)
        .catch((err) => logger.error('[Agora] Doctor video token fetch failed:', err))
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
    engine.setEnableSpeakerphone(true)
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
    try { getAgoraEngine().muteLocalVideoStream(camOff) } catch {}
  }, [camOff, agoraReady])

  // Sync speaker
  useEffect(() => {
    if (!agoraReady) return
    try { getAgoraEngine().setEnableSpeakerphone(speakerOn) } catch {}
  }, [speakerOn, agoraReady])

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {showEndSheet && (
        <EndConsultationSheet
          consultationId={consultationId ?? ''}
          patientName={displayName}
          onSubmit={() => { setShowEndSheet(false); router.replace('/(doctor)/(tabs)/consultations') }}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Patient video (full screen) */}
      <View style={styles.mainVideo}>
        {agoraReady && remoteUid && RtcSurfaceView ? (
          <RtcSurfaceView
            canvas={{ uid: remoteUid }}
            style={styles.fullFill}
          />
        ) : (
          <View style={styles.patientVideoPlaceholder}>
            <Ionicons name="person" size={80} color="rgba(255,255,255,0.15)" />
            <Text style={styles.patientVideoName}>{displayName}</Text>
            <Text style={styles.patientVideoSub}>
              {joined ? 'Waiting for patient...' : 'Connecting...'}
            </Text>
          </View>
        )}

        {/* Timer overlay */}
        <View style={styles.timerOverlay}>
          <View style={styles.timerBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.timerText}>{formatTime(seconds)}</Text>
          </View>
        </View>

        {/* Doctor self-view (top-right) */}
        <View style={styles.selfView}>
          {agoraReady && !camOff && RtcSurfaceView ? (
            <RtcSurfaceView
              canvas={{ uid: 0, sourceType: VideoSourceCamera }}
              style={styles.selfViewFill}
            />
          ) : (
            <View style={styles.selfViewOff}>
              <Ionicons
                name={camOff ? 'videocam-off' : 'person'}
                size={22}
                color="rgba(255,255,255,0.5)"
              />
            </View>
          )}
          <Text style={styles.selfLabel}>You</Text>
        </View>

        {/* Screen share badge removed — feature not available */}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <Pressable
            style={[styles.controlBtn, muted && styles.controlBtnActive]}
            onPress={() => setMuted(m => !m)}
          >
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={22} color={muted ? colors.mistWhite : colors.inkBlack} />
            <Text style={[styles.controlLabel, muted && styles.controlLabelActive]}>{muted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>

          <Pressable
            style={[styles.controlBtn, camOff && styles.controlBtnActive]}
            onPress={() => setCamOff(c => !c)}
          >
            <Ionicons name={camOff ? 'videocam-off' : 'videocam'} size={22} color={camOff ? colors.mistWhite : colors.inkBlack} />
            <Text style={[styles.controlLabel, camOff && styles.controlLabelActive]}>{camOff ? 'Cam On' : 'Cam Off'}</Text>
          </Pressable>

          <Pressable style={styles.endBtn} onPress={() => setShowEndSheet(true)}>
            <Ionicons name="call" size={26} color={colors.mistWhite} />
          </Pressable>

          <Pressable
            style={[styles.controlBtn, speakerOn && styles.controlBtnActive]}
            onPress={() => setSpeakerOn(s => !s)}
          >
            <Ionicons name={speakerOn ? 'volume-high' : 'volume-mute'} size={22} color={speakerOn ? colors.mistWhite : colors.inkBlack} />
            <Text style={[styles.controlLabel, speakerOn && styles.controlLabelActive]}>Speaker</Text>
          </Pressable>

        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },
  fullFill: { flex: 1 },

  mainVideo: { flex: 1, position: 'relative' },
  patientVideoPlaceholder: {
    flex: 1, backgroundColor: '#0D1A3A',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  patientVideoName: { fontFamily: fonts.bold, fontSize: 22, color: 'rgba(255,255,255,0.6)' },
  patientVideoSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.3)' },

  timerOverlay: { position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  timerText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },

  selfView: { position: 'absolute', top: 70, right: 16, alignItems: 'center', gap: 4 },
  selfViewFill: { width: 90, height: 120, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  selfViewOff: {
    width: 90, height: 120, borderRadius: 14,
    backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
  },
  selfLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.6)' },

  screenShareBadge: { position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  screenShareText: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },

  controls: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlBtn: { alignItems: 'center', gap: 6, width: 58, height: 58, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  controlBtnActive: { backgroundColor: colors.careBlue },
  controlLabel: { fontFamily: fonts.medium, fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  controlLabelActive: { color: colors.mistWhite },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', shadowColor: colors.error, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6, transform: [{ rotate: '135deg' }] },
})
