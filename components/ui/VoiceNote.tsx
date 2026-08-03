import { Audio } from 'expo-av'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState, useCallback } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

// ─── Recording UI ─────────────────────────────────────────────────────────────

interface VoiceNoteRecorderProps {
  onSend: (uri: string, durationSec: number) => Promise<void>
  disabled?: boolean
}

export function VoiceNoteRecorder({ onSend, disabled }: VoiceNoteRecorderProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'recorded' | 'sending'>('idle')
  const [durationSec, setDurationSec] = useState(0)
  const [playPos, setPlayPos] = useState(0)
  const [playDur, setPlayDur] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const recordingRef = useRef<Audio.Recording | null>(null)
  const soundRef = useRef<Audio.Sound | null>(null)
  const uriRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pulseAnim = useSharedValue(1)

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    })
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      soundRef.current?.unloadAsync()
      recordingRef.current?.stopAndUnloadAsync()
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (disabled) return
    const { granted } = await Audio.requestPermissionsAsync()
    if (!granted) {
      Alert.alert('Microphone Permission', 'Please allow microphone access to record voice notes.')
      return
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
    recordingRef.current = recording
    setDurationSec(0)
    timerRef.current = setInterval(() => setDurationSec(s => s + 1), 1000)
    pulseAnim.value = withRepeat(withTiming(1.3, { duration: 600, easing: Easing.ease }), -1, true)
    setState('recording')
  }, [disabled])

  const stopRecording = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current)
    pulseAnim.value = withTiming(1)
    await recordingRef.current?.stopAndUnloadAsync()
    const uri = recordingRef.current?.getURI()
    if (!uri) return
    uriRef.current = uri
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true })
    const { sound, status } = await Audio.Sound.createAsync({ uri })
    soundRef.current = sound
    setPlayDur(status.isLoaded ? Math.round((status.durationMillis ?? 0) / 1000) : durationSec)
    sound.setOnPlaybackStatusUpdate(s => {
      if (!s.isLoaded) return
      setPlayPos(s.positionMillis ?? 0)
      if (s.didJustFinish) setIsPlaying(false)
    })
    setState('recorded')
  }, [durationSec])

  const togglePlay = useCallback(async () => {
    if (!soundRef.current) return
    if (isPlaying) {
      await soundRef.current.pauseAsync()
      setIsPlaying(false)
    } else {
      await soundRef.current.playAsync()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const discard = useCallback(async () => {
    await soundRef.current?.unloadAsync()
    soundRef.current = null
    uriRef.current = null
    setDurationSec(0); setPlayPos(0); setPlayDur(0); setIsPlaying(false)
    setState('idle')
  }, [])

  const handleSend = useCallback(async () => {
    if (!uriRef.current) return
    setState('sending')
    try {
      // prefer actual audio duration from file metadata; fall back to timer
      await onSend(uriRef.current, playDur > 0 ? playDur : durationSec)
      await discard()
    } catch {
      setState('recorded')
    }
  }, [onSend, playDur, durationSec, discard])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const progressPct = playDur > 0 ? Math.min((playPos / (playDur * 1000)) * 100, 100) : 0

  if (state === 'idle') {
    return (
      <Pressable
        onPress={startRecording}
        disabled={disabled}
        style={({ pressed }) => [styles.micBtn, pressed && { opacity: 0.7 }, disabled && { opacity: 0.4 }]}
        accessibilityLabel="Record voice note"
        accessibilityRole="button"
      >
        <Ionicons name="mic-outline" size={20} color={colors.inkBlack} style={{ opacity: 0.6 }} />
      </Pressable>
    )
  }

  if (state === 'recording') {
    return (
      <View style={styles.recordingWrap} accessibilityLabel={`Recording: ${fmt(durationSec)}`} accessibilityLiveRegion="polite">
        <Animated.View style={[styles.pulseDot, { transform: [{ scale: pulseAnim }] }]} />
        <Text style={styles.timerText}>{fmt(durationSec)}</Text>
        <Pressable onPress={stopRecording} style={styles.stopBtn} accessibilityLabel="Stop recording" accessibilityRole="button">
          <View style={styles.stopIcon} />
        </Pressable>
      </View>
    )
  }

  if (state === 'recorded') {
    return (
      <View style={styles.playerWrap}>
        <Pressable onPress={togglePlay} style={styles.playBtn} accessibilityLabel={isPlaying ? 'Pause' : 'Play voice note'} accessibilityRole="button">
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={14} color={colors.mistWhite} />
        </Pressable>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={styles.durText}>{fmt(playDur)}</Text>
        <Pressable onPress={discard} style={styles.discardBtn} accessibilityLabel="Discard voice note" accessibilityRole="button">
          <Ionicons name="close" size={14} color="#6B7280" />
        </Pressable>
        <Pressable onPress={handleSend} style={styles.sendBtn} accessibilityLabel="Send voice note" accessibilityRole="button">
          <Ionicons name="send" size={14} color={colors.mistWhite} />
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.sendingWrap}>
      <ActivityIndicator size="small" color={colors.tealGreen} />
      <Text style={styles.sendingText}>Sending…</Text>
    </View>
  )
}

// ─── Playback-only component (for received voice notes in message list) ────────

interface VoiceNotePlayerProps {
  uri: string
  durationSec?: number
  isMine?: boolean
}

export function VoiceNotePlayer({ uri, durationSec = 0, isMine }: VoiceNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const [totalDur, setTotalDur] = useState(durationSec)
  const soundRef = useRef<Audio.Sound | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync() }
  }, [])

  const loadAndPlay = async () => {
    if (!loadedRef.current) {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true })
      const { sound, status } = await Audio.Sound.createAsync({ uri })
      soundRef.current = sound
      loadedRef.current = true
      if (status.isLoaded) setTotalDur(Math.round((status.durationMillis ?? 0) / 1000))
      sound.setOnPlaybackStatusUpdate(s => {
        if (!s.isLoaded) return
        setPlayPos(s.positionMillis ?? 0)
        if (s.didJustFinish) { setIsPlaying(false); setPlayPos(0) }
      })
    }
    await soundRef.current?.playAsync()
    setIsPlaying(true)
  }

  const toggle = async () => {
    if (isPlaying) { await soundRef.current?.pauseAsync(); setIsPlaying(false) }
    else await loadAndPlay()
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const pct = totalDur > 0 ? Math.min((playPos / (totalDur * 1000)) * 100, 100) : 0
  const accent = isMine ? colors.mistWhite : colors.tealGreen

  return (
    <Pressable
      onPress={toggle}
      style={[styles.playerWrap, { backgroundColor: isMine ? 'rgba(255,255,255,0.15)' : colors.cloudGrey }]}
      accessibilityLabel={`Voice note ${isPlaying ? '(playing)' : ''}`}
      accessibilityRole="button"
    >
      <View style={[styles.playBtn, { backgroundColor: accent }]}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={14} color={isMine ? colors.tealGreen : colors.mistWhite} />
      </View>
      <View style={[styles.progressBar, { backgroundColor: isMine ? 'rgba(255,255,255,0.3)' : colors.steelGrey }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>
      <Text style={[styles.durText, { color: isMine ? 'rgba(255,255,255,0.8)' : '#6B7280' }]}>
        {fmt(isPlaying ? Math.round(playPos / 1000) : totalDur)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  micBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  recordingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: '#FECACA',
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  timerText: { fontFamily: fonts.bold, fontSize: 13, color: '#EF4444', fontVariant: ['tabular-nums'] },
  stopBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  stopIcon: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.mistWhite },
  playerWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7,
  },
  playBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center',
  },
  progressBar: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.steelGrey, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.tealGreen },
  durText: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', fontVariant: ['tabular-nums'] },
  discardBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.careBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  sendingWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  sendingText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
})
