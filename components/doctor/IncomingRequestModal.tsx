import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'

export interface IncomingRequestModalProps {
  visible: boolean
  patientName: string
  patientAge: number
  consultationType: 'chat' | 'phone' | 'video'
  price: number
  currency: string
  consultationId: string
  waitingStartedAt?: string
  onAccept: () => void
  onDecline: (reason: string) => void
}

const WAITING_DURATION = 3 * 60

function calcSecondsLeft(waitingStartedAt?: string): number {
  if (!waitingStartedAt) return WAITING_DURATION
  const elapsed = Math.floor((Date.now() - new Date(waitingStartedAt).getTime()) / 1000)
  return Math.max(0, WAITING_DURATION - elapsed)
}

const DECLINE_REASONS = ['Currently busy', 'Wrong specialty', 'Technical issue', 'Other']
const CONSULTATION_ICONS = { chat: '💬', phone: '📞', video: '🎥' }
const TYPE_BADGE_BG = { chat: '#EFF6FF', phone: '#F0FDF4', video: '#FFF7ED' }

export function IncomingRequestModal({
  visible,
  patientName,
  patientAge,
  consultationType,
  price,
  currency,
  waitingStartedAt,
  onAccept,
  onDecline,
}: IncomingRequestModalProps) {
  const [timeLeft, setTimeLeft] = useState(() => calcSecondsLeft(waitingStartedAt))
  const [showDeclineSheet, setShowDeclineSheet] = useState(false)
  const bellAnim = useRef(new Animated.Value(0)).current

  // Reset timer when modal becomes visible, syncing from actual waiting start time
  useEffect(() => {
    if (visible) {
      setTimeLeft(calcSecondsLeft(waitingStartedAt))
      setShowDeclineSheet(false)
    }
  }, [visible])

  // Bell bounce animation
  useEffect(() => {
    if (!visible) return
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bellAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(bellAnim, { toValue: -1, duration: 300, useNativeDriver: true }),
        Animated.timing(bellAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.delay(800),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [visible])

  // 30-second countdown
  useEffect(() => {
    if (!visible) return
    if (timeLeft <= 0) {
      onDecline('Timeout')
      return
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLeft, visible])

  const timerColor =
    timeLeft > 60 ? colors.success : timeLeft > 30 ? colors.warning : colors.error
  const minutes = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  const handleDecline = (reason: string) => {
    setShowDeclineSheet(false)
    onDecline(reason)
  }

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Animated bell */}
          <Animated.View
            style={{
              transform: [
                {
                  rotate: bellAnim.interpolate({
                    inputRange: [-1, 1],
                    outputRange: ['-15deg', '15deg'],
                  }),
                },
              ],
            }}
          >
            <View style={styles.bellWrap}>
              <Ionicons name="notifications" size={32} color={colors.warning} />
            </View>
          </Animated.View>

          <Text style={styles.title}>New Consultation Request</Text>
          <View style={styles.divider} />

          {/* Patient row */}
          <View style={styles.patientRow}>
            <View style={styles.patientAvatar}>
              <Text style={styles.patientInitial}>{patientName[0]?.toUpperCase()}</Text>
            </View>
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>{patientName}</Text>
              <Text style={styles.patientAge}>Age: {patientAge}</Text>
            </View>
            <View style={[styles.typeBadge, { backgroundColor: TYPE_BADGE_BG[consultationType] }]}>
              <Text style={styles.typeBadgeText}>
                {CONSULTATION_ICONS[consultationType]}{' '}
                {consultationType === 'chat'
                  ? 'Chat'
                  : consultationType === 'phone'
                  ? 'Phone Call'
                  : 'Video Call'}
              </Text>
            </View>
          </View>

          {/* Price */}
          <View style={styles.priceWrap}>
            <Text style={styles.priceLabel}>Patient pays:</Text>
            <Text style={styles.priceAmount}>
              {currency} {price.toLocaleString()}
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Countdown timer */}
          <View style={[styles.timerCircle, { borderColor: timerColor }]}>
            <Text style={[styles.timerNumber, { color: timerColor }]}>
              {String(minutes).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => setShowDeclineSheet(true)}
              style={styles.declineBtn}
            >
              <Text style={styles.declineBtnText}>Decline</Text>
            </Pressable>
            <Pressable onPress={onAccept} style={styles.acceptBtnWrap}>
              <LinearGradient
                colors={['#00CB53', '#00A843']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.acceptGrad}
              >
                <Text style={styles.acceptBtnText}>Accept</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        {/* Decline reason sheet */}
        {showDeclineSheet && (
          <View style={styles.sheetBackdrop}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowDeclineSheet(false)} />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Why are you declining?</Text>
              {DECLINE_REASONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => handleDecline(r)}
                  style={styles.reasonItem}
                >
                  <Text style={styles.reasonText}>{r}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    backgroundColor: colors.mistWhite, borderRadius: 24, padding: 24,
    width: '100%', alignItems: 'center', gap: 12,
    ...shadow('#000', 0, 10, 24, 0.15, 20),
  },

  bellWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkBlack, textAlign: 'center' },
  divider: { width: '100%', height: 1, backgroundColor: colors.cloudGrey },

  patientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'flex-start', width: '100%' },
  patientAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center',
  },
  patientInitial: { fontFamily: fonts.bold, fontSize: 20, color: colors.mistWhite },
  patientInfo: { flex: 1 },
  patientName: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  patientAge: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  typeBadge: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack },

  priceWrap: { alignItems: 'center' },
  priceLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 2 },
  priceAmount: { fontFamily: fonts.bold, fontSize: 28, color: colors.tealGreen },

  timerCircle: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  timerNumber: { fontFamily: fonts.bold, fontSize: 26 },

  btnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  declineBtn: {
    flex: 1, height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.steelGrey,
    backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center',
  },
  declineBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#6B7280' },
  acceptBtnWrap: { flex: 1.5, borderRadius: 16, overflow: 'hidden' },
  acceptGrad: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  acceptBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },

  sheetBackdrop: { position: 'absolute', inset: 0, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: colors.steelGrey,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 12 },
  reasonItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  reasonText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
})
