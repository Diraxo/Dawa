import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import { Animated, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'

export interface IncomingRequestModalProps {
  visible: boolean
  patientName: string
  patientAge: number
  patientPhotoUrl?: string | null
  consultationType: 'chat' | 'phone' | 'video'
  price: number
  currency: string
  consultationId: string
  onAccept: () => void
  onDecline: (reason: string) => void
}

const DECLINE_REASONS = ['Currently busy', 'Wrong specialty', 'Technical issue', 'Other']
// Matches the chat/phone/video icon + color convention used across the app
// (see BookingModal's CONSULT_TYPES) — Ionicons only, no emoji.
const CONSULTATION_ICONS = { chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam' } as const
const TYPE_ICON_COLOR = { chat: colors.tealGreen, phone: colors.careBlue, video: '#7C3AED' }
const TYPE_BADGE_BG = { chat: '#EFF6FF', phone: '#F0FDF4', video: '#FFF7ED' }

export function IncomingRequestModal({
  visible,
  patientName,
  patientAge,
  patientPhotoUrl,
  consultationType,
  price,
  currency,
  onAccept,
  onDecline,
}: IncomingRequestModalProps) {
  const insets = useSafeAreaInsets()
  const [showDeclineSheet, setShowDeclineSheet] = useState(false)
  const bellAnim = useRef(new Animated.Value(0)).current

  // Reset decline sheet each time the modal becomes visible for a new request
  useEffect(() => {
    if (visible) {
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

  const handleDecline = (reason: string) => {
    setShowDeclineSheet(false)
    onDecline(reason)
  }

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(24, insets.top + 12),
            paddingBottom: Math.max(24, insets.bottom + 12),
          },
        ]}
      >
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
              {patientPhotoUrl ? (
                <Image source={{ uri: patientPhotoUrl }} style={styles.patientAvatarImage} />
              ) : (
                <Text style={styles.patientInitial}>{patientName[0]?.toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>{patientName}</Text>
              <Text style={styles.patientAge}>Age: {patientAge}</Text>
            </View>
            <View style={[styles.typeBadge, { backgroundColor: TYPE_BADGE_BG[consultationType] }]}>
              <Ionicons
                name={CONSULTATION_ICONS[consultationType]}
                size={16}
                color={TYPE_ICON_COLOR[consultationType]}
              />
              <Text style={[styles.typeBadgeText, { color: TYPE_ICON_COLOR[consultationType] }]}>
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

          {/* Action buttons */}
          <View style={{ marginTop: 4 }}>
            <ConsultationActionButtons
              onDecline={() => setShowDeclineSheet(true)}
              onAccept={onAccept}
            />
          </View>
        </View>

        {/* Decline reason sheet */}
        {showDeclineSheet && (
          <View style={styles.sheetBackdrop}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowDeclineSheet(false)} />
            <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 12) }]}>
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
    overflow: 'hidden',
  },
  patientAvatarImage: { width: '100%', height: '100%', borderRadius: 23 },
  patientInitial: { fontFamily: fonts.bold, fontSize: 20, color: colors.mistWhite },
  patientInfo: { flex: 1 },
  patientName: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  patientAge: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  priceWrap: { alignItems: 'center' },
  priceLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 2 },
  priceAmount: { fontFamily: fonts.bold, fontSize: 28, color: colors.tealGreen },

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
