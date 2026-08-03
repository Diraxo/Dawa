import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { LinearGradient } from 'expo-linear-gradient'
import { shadow } from '@/lib/shadow'

interface Props {
  visible: boolean
  rawStatus?: string | null
  onViewSummary: () => void
  onClose: () => void
}

// The one completion dialog shown to a patient once a consultation (chat,
// phone, or video — any booking type) reaches a terminal status, replacing
// the previous plain native Alert.alert / ad hoc "Call Ended" screens so all
// three consultation types present identically styled, on-brand messaging.
//
// rawStatus must be branched on — this fires for ANY terminal status
// (completed, missed, cancelled, declined, ended_abnormally), not just a
// doctor-completed consultation. Without branching, a patient whose call was
// never answered saw the exact same "Consultation Completed / Your doctor
// has completed your consultation" copy the doctor's own screen correctly
// showed as "Missed Call" for.
function copyFor(rawStatus: string | null | undefined) {
  switch (rawStatus) {
    case 'missed':
      return {
        title: 'Consultation Missed',
        message: 'The consultation ended before it could connect.\n\nIf you were charged, a credit has been applied to your account.',
      }
    case 'call_declined':
    case 'declined':
      return {
        title: 'Call Declined',
        message: 'The doctor declined this consultation.\n\nIf you were charged, a credit has been applied to your account.',
      }
    case 'cancelled':
      return {
        title: 'Consultation Cancelled',
        message: 'This consultation was cancelled.',
      }
    case 'ended_abnormally':
      return {
        title: 'Consultation Ended',
        message: 'The consultation ended unexpectedly.',
      }
    default:
      return {
        title: 'Consultation Completed',
        message: 'Your doctor has completed your consultation.\n\nYour consultation summary is now available.',
      }
  }
}

export function ConsultationCompletedModal({ visible, rawStatus, onViewSummary, onClose }: Props) {
  const scale = useRef(new Animated.Value(0.9)).current
  const opacity = useRef(new Animated.Value(0)).current
  const { title, message } = copyFor(rawStatus)
  const isCompleted = !rawStatus || rawStatus === 'completed'

  useEffect(() => {
    if (!visible) return
    scale.setValue(0.9)
    opacity.setValue(0)
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()
  }, [visible, scale, opacity])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        accessibilityRole="alert"
      >
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <View style={styles.iconCircle}>
            <Ionicons
              name={isCompleted ? 'checkmark-circle' : 'information-circle'}
              size={44}
              color={isCompleted ? colors.tealGreen : colors.warning}
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {isCompleted && (
          <Pressable
            onPress={onViewSummary}
            accessibilityRole="button"
            accessibilityLabel="View Summary"
            style={({ pressed }) => [styles.primaryWrap, pressed && { opacity: 0.88 }]}
          >
            <LinearGradient
              colors={gradients.interactive}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryText}>View Summary</Text>
            </LinearGradient>
          </Pressable>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.mistWhite,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    ...shadow('#000', 0, 12, 28, 0.22, 12),
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#F0FDFB',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.bold, fontSize: 20, color: colors.inkBlack,
    marginBottom: 10, textAlign: 'center',
  },
  message: {
    fontFamily: fonts.regular, fontSize: 14, color: '#6B7280',
    textAlign: 'center', lineHeight: 21, marginBottom: 24,
  },
  primaryWrap: { width: '100%', borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  primaryBtn: { height: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  secondaryBtn: { height: 46, alignItems: 'center', justifyContent: 'center', width: '100%' },
  secondaryText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#6B7280' },
})
