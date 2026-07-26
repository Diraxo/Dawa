import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'

export type AlertVariant = 'success' | 'error' | 'warning' | 'info' | 'confirm' | 'logout'

export interface AlertButton {
  text: string
  style?: 'primary' | 'outline' | 'danger'
  onPress?: () => void
}

interface CareHubAlertProps {
  visible: boolean
  variant?: AlertVariant
  title: string
  message: string
  buttons: AlertButton[]
  onClose?: () => void
}

const VARIANT_CONFIG: Record<AlertVariant, { icon: string; iconColor: string; bgColor: string }> = {
  success: { icon: 'checkmark-circle', iconColor: '#00BFA5', bgColor: '#E6FAF7' },
  error:   { icon: 'close-circle',     iconColor: '#D32F2F', bgColor: '#FDECEA' },
  warning: { icon: 'warning',          iconColor: '#FFC107', bgColor: '#FFF8E1' },
  info:    { icon: 'information-circle',iconColor: '#0288D1', bgColor: '#E8F4FD' },
  confirm: { icon: 'help-circle',      iconColor: '#1A4598', bgColor: '#EEF2FF' },
  logout:  { icon: 'log-out-outline',  iconColor: '#D32F2F', bgColor: '#FDECEA' },
}

export function CareHubAlert({
  visible,
  variant = 'info',
  title,
  message,
  buttons,
  onClose,
}: CareHubAlertProps) {
  const scaleAnim = useRef(new Animated.Value(0.85)).current
  const opacityAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      scaleAnim.setValue(0.85)
      opacityAnim.setValue(0)
    }
  }, [visible])

  const cfg = VARIANT_CONFIG[variant]

  const renderButton = (btn: AlertButton, idx: number) => {
    const isLast = idx === buttons.length - 1

    if (btn.style === 'outline') {
      return (
        <Pressable
          key={idx}
          onPress={btn.onPress}
          style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.outlineBtnText}>{btn.text}</Text>
        </Pressable>
      )
    }

    if (btn.style === 'danger') {
      return (
        <Pressable
          key={idx}
          onPress={btn.onPress}
          style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.dangerBtnText}>{btn.text}</Text>
        </Pressable>
      )
    }

    // Default: primary gradient
    return (
      <Pressable
        key={idx}
        onPress={btn.onPress}
        style={({ pressed }) => [styles.primaryBtnWrap, pressed && { opacity: 0.9 }]}
      >
        <LinearGradient
          colors={['#2962FF', '#00BFA5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryBtnText}>{btn.text}</Text>
        </LinearGradient>
      </Pressable>
    )
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <Pressable style={styles.overlayTouch} onPress={onClose} />
        <Animated.View
          style={[
            styles.card,
            { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
          ]}
        >
          {/* Icon */}
          <View style={[styles.iconCircle, { backgroundColor: cfg.bgColor }]}>
            <Ionicons name={cfg.icon as never} size={36} color={cfg.iconColor} />
          </View>

          {/* Text */}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Buttons */}
          <View style={[styles.btnRow, buttons.length === 1 && styles.btnRowSingle]}>
            {buttons.map((btn, idx) => renderButton(btn, idx))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 14, 39, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  overlayTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    ...shadow('#000', 0, 8, 24, 0.18, 20),
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.inkBlack,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 10,
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.steelGrey,
    width: '100%',
    marginVertical: 20,
    opacity: 0.5,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  btnRowSingle: {
    flexDirection: 'column',
  },
  primaryBtnWrap: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  primaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  outlineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  outlineBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.inkBlack,
  },
  dangerBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEA',
    borderWidth: 1.5,
    borderColor: '#D32F2F',
  },
  dangerBtnText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#D32F2F',
  },
})
