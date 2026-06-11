import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
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
import { gradients } from '@/constants/gradients'

const TYPE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  chat:  { icon: 'chatbubble-ellipses', label: 'Chat Consultation',  color: colors.tealGreen,    bg: 'rgba(0,191,165,0.15)' },
  phone: { icon: 'call',                label: 'Phone Consultation', color: colors.careBlue,     bg: 'rgba(26,69,152,0.15)' },
  video: { icon: 'videocam',            label: 'Video Consultation', color: '#7C3AED',            bg: 'rgba(124,58,237,0.15)' },
}

const TOTAL_SECONDS = 30

export default function IncomingRequestScreen() {
  const router = useRouter()
  const {
    patientName,
    patientId,
    consultationType,
    consultationId,
  } = useLocalSearchParams<{
    patientName: string
    patientId?: string
    consultationType: string
    consultationId?: string
  }>()

  const meta = TYPE_META[consultationType ?? 'chat'] ?? TYPE_META.chat
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)
  const [responded, setResponded] = useState(false)

  // Countdown
  useEffect(() => {
    if (responded) return
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(interval)
          handleAutoDecline()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [responded])

  // Circular progress arc (SVG-free: use a rotating conic fill via Animated)
  const progress = useRef(new Animated.Value(1)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: TOTAL_SECONDS * 1000,
      useNativeDriver: false,
    }).start()
  }, [])

  // Pulse on the avatar
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  const handleAutoDecline = () => {
    if (responded) return
    setResponded(true)
    Alert.alert(
      'Request Expired',
      'You did not respond in time. The request has been automatically declined.',
      [{ text: 'OK', onPress: () => router.back() }]
    )
  }

  const handleDecline = () => {
    Alert.alert(
      'Decline Request',
      `Are you sure you want to decline ${patientName ?? 'this patient'}'s request?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => {
            setResponded(true)
            router.back()
          },
        },
      ]
    )
  }

  const handleAccept = () => {
    setResponded(true)
    const params = {
      patientName: patientName ?? 'Patient',
      patientId: patientId ?? '',
      consultationId: consultationId ?? `consult-${patientId ?? 'demo'}`,
    }
    const route =
      consultationType === 'phone'
        ? '/(doctor)/phone-consultation'
        : consultationType === 'video'
          ? '/(doctor)/video-consultation'
          : '/(doctor)/chat-consultation'

    router.replace({ pathname: route as any, params })
  }

  const timerColor = secondsLeft <= 10 ? colors.error : secondsLeft <= 20 ? colors.warning : colors.tealGreen

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top badge */}
      <View style={styles.topRow}>
        <View style={[styles.typeBadge, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon as any} size={16} color={meta.color} />
          <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Center */}
      <View style={styles.center}>
        {/* Incoming label */}
        <Text style={styles.incomingLabel}>Incoming Request</Text>

        {/* Avatar with pulse */}
        <Animated.View style={[styles.avatarWrap, { transform: [{ scale: pulse }] }]}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={56} color="rgba(255,255,255,0.5)" />
          </View>
        </Animated.View>

        <Text style={styles.patientName}>{patientName ?? 'Patient'}</Text>
        <Text style={styles.patientSub}>wants to start a {meta.label.toLowerCase()}</Text>

        {/* Timer ring */}
        <View style={styles.timerContainer}>
          <View style={styles.timerRingTrack}>
            <Text style={[styles.timerNumber, { color: timerColor }]}>
              {String(secondsLeft).padStart(2, '0')}
            </Text>
            <Text style={styles.timerSec}>sec</Text>
          </View>
          <Text style={styles.timerHint}>Auto-declines when timer expires</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {/* Decline */}
        <Pressable
          style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.75 }]}
          onPress={handleDecline}
        >
          <Ionicons name="close" size={28} color={colors.error} />
          <Text style={styles.declineLabel}>Decline</Text>
        </Pressable>

        {/* Accept */}
        <Pressable
          style={({ pressed }) => [styles.acceptWrap, pressed && { opacity: 0.88 }]}
          onPress={handleAccept}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.acceptBtn}
          >
            <Ionicons name="checkmark" size={28} color={colors.mistWhite} />
            <Text style={styles.acceptLabel}>Accept</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },

  topRow: { alignItems: 'center', paddingTop: 20 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  incomingLabel: {
    fontFamily: fonts.medium, fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.5, textTransform: 'uppercase',
    marginBottom: 28,
  },

  avatarWrap: { marginBottom: 24 },
  avatarCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
  },

  patientName: {
    fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite,
    textAlign: 'center', marginBottom: 6,
  },
  patientSub: {
    fontFamily: fonts.regular, fontSize: 14,
    color: 'rgba(255,255,255,0.6)', textAlign: 'center',
    marginBottom: 36,
  },

  timerContainer: { alignItems: 'center', gap: 10 },
  timerRingTrack: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  timerNumber: { fontFamily: fonts.bold, fontSize: 34 },
  timerSec: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: -4 },
  timerHint: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.35)' },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 20, paddingHorizontal: 32, paddingBottom: 40,
  },

  declineBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(211,47,47,0.15)',
    borderWidth: 2, borderColor: colors.error,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  declineLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.error },

  acceptWrap: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden' },
  acceptBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4,
    shadowColor: colors.tealGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  acceptLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.mistWhite },
})
