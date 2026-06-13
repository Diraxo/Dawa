import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
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
import { getAuthClient, supabase } from '@/lib/supabase'

const ICON_MAP: Record<string, { icon: string; label: string; color: string }> = {
  chat: { icon: 'chatbubble-ellipses', label: 'Chat', color: colors.tealGreen },
  phone: { icon: 'call', label: 'Phone Call', color: colors.careBlue },
  video: { icon: 'videocam', label: 'Video Call', color: '#7C3AED' },
}

const ROUTE_MAP: Record<string, string> = {
  chat: '/(patient)/chat-consultation',
  phone: '/(patient)/phone-consultation',
  video: '/(patient)/video-consultation',
}

export default function WaitingRoomScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const {
    consultationId,
    doctorId,
    doctorName,
    consultationType,
  } = useLocalSearchParams<{
    consultationId: string
    doctorId: string
    doctorName: string
    consultationType: string
  }>()

  const typeInfo = ICON_MAP[consultationType ?? 'chat'] ?? ICON_MAP.chat
  const [secondsLeft, setSecondsLeft] = useState(30)
  const navigated = useRef(false)

  // ── Realtime subscription for consultation status changes ─────────────────
  useEffect(() => {
    if (!consultationId) return

    const channel = supabase
      .channel(`waiting-${consultationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `id=eq.${consultationId}`,
        },
        (payload) => {
          const newStatus: string = (payload.new as any)?.status ?? ''
          if (navigated.current) return

          if (newStatus === 'active') {
            navigated.current = true
            router.replace({
              pathname: ROUTE_MAP[consultationType ?? 'chat'] as any,
              params: { consultationId, doctorId, doctorName: doctorName ?? 'Doctor' },
            })
          } else if (newStatus === 'cancelled') {
            navigated.current = true
            Alert.alert(
              'Request Declined',
              'The doctor has declined your request. Please try another doctor.',
              [{ text: 'OK', onPress: () => router.back() }]
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [consultationId])

  // ── 30-second countdown; auto-cancel on timeout ───────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timer)
          if (!navigated.current) {
            navigated.current = true
            // Mark the consultation as cancelled on timeout
            getToken().then(token => {
              if (token && consultationId) {
                getAuthClient(token)
                  .from('consultations')
                  .update({ status: 'cancelled' })
                  .eq('id', consultationId)
                  .then(() => {})
              }
            })
            Alert.alert(
              'No Response',
              'The doctor did not respond in time. Please try again or choose another doctor.',
              [{ text: 'OK', onPress: () => router.back() }]
            )
          }
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // ── Pulsing ring animation ────────────────────────────────────────────────
  const pulse1 = useRef(new Animated.Value(1)).current
  const pulse2 = useRef(new Animated.Value(1)).current
  const opacity1 = useRef(new Animated.Value(0.6)).current
  const opacity2 = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const animRing = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1.5, duration: 1400, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: delay === 0 ? 0.6 : 0.3, duration: 0, useNativeDriver: true }),
          ]),
        ])
      )
    const a1 = animRing(pulse1, opacity1, 0)
    const a2 = animRing(pulse2, opacity2, 600)
    a1.start(); a2.start()
    return () => { a1.stop(); a2.stop() }
  }, [])

  const handleCancel = () => {
    Alert.alert('Cancel Request', 'Are you sure you want to cancel the consultation request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          if (!navigated.current) {
            navigated.current = true
            const token = await getToken()
            if (token && consultationId) {
              await getAuthClient(token)
                .from('consultations')
                .update({ status: 'cancelled' })
                .eq('id', consultationId)
            }
          }
          router.back()
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.typeBadge, { backgroundColor: `${typeInfo.color}18` }]}>
          <Ionicons name={typeInfo.icon as any} size={16} color={typeInfo.color} />
          <Text style={[styles.typeBadgeText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
        </View>
      </View>

      {/* Main content */}
      <View style={styles.center}>
        {/* Pulsing icon */}
        <View style={styles.pulseWrap}>
          <Animated.View style={[styles.ring, styles.ring1, { transform: [{ scale: pulse1 }], opacity: opacity1 }]} />
          <Animated.View style={[styles.ring, styles.ring2, { transform: [{ scale: pulse2 }], opacity: opacity2 }]} />
          <View style={styles.photoCircle}>
            <Ionicons name="person" size={52} color={colors.steelGrey} />
          </View>
        </View>

        <Text style={styles.waitingTitle}>Waiting for</Text>
        <Text style={styles.doctorName}>{doctorName ?? 'Doctor'}</Text>

        {/* Timer */}
        <View style={styles.timerWrap}>
          <Text style={styles.timerLabel}>Auto-cancels in</Text>
          <Text style={[styles.timerValue, secondsLeft <= 10 && styles.timerUrgent]}>
            00:{String(secondsLeft).padStart(2, '0')}
          </Text>
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <View style={[styles.statusDot, styles.statusDotMid]} />
          <View style={styles.statusDot} />
        </View>
        <Text style={styles.statusText}>Sending request to doctor...</Text>
      </View>

      {/* Cancel button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.75 }]}
          onPress={handleCancel}
        >
          <Ionicons name="close-circle-outline" size={20} color={colors.error} />
          <Text style={styles.cancelText}>Cancel Request</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },

  header: { alignItems: 'center', paddingTop: 20, paddingBottom: 10 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  pulseWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 28, width: 160, height: 160 },
  ring: { position: 'absolute', borderRadius: 80, borderWidth: 2 },
  ring1: { width: 140, height: 140, borderColor: colors.tealGreen },
  ring2: { width: 140, height: 140, borderColor: colors.careBlue },
  photoCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
  },

  waitingTitle: { fontFamily: fonts.regular, fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  doctorName: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite, textAlign: 'center', marginBottom: 24 },

  timerWrap: { alignItems: 'center', marginBottom: 28 },
  timerLabel: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 4 },
  timerValue: { fontFamily: fonts.bold, fontSize: 36, color: colors.mistWhite },
  timerUrgent: { color: colors.error },

  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  statusDotMid: { backgroundColor: colors.tealGreen },
  statusText: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)' },

  footer: { paddingHorizontal: 20, paddingBottom: 24 },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.error,
    backgroundColor: 'rgba(211,47,47,0.1)',
  },
  cancelText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.error },
})
