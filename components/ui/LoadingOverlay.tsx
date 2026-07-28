import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef } from 'react'
import { Animated, Modal, StyleSheet, Text, View } from 'react-native'

import { DawaLogo } from '@/components/ui/DawaLogo'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'

interface LoadingOverlayProps {
  visible: boolean
  message?: string
}

export function LoadingOverlay({ visible, message = 'Please wait...' }: LoadingOverlayProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.92)).current
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      ]).start()

      // Gentle pulse on the card
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.015, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start()
    } else {
      fadeAnim.setValue(0)
      scaleAnim.setValue(0.92)
      pulseAnim.setValue(1)
    }
  }, [visible])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <LinearGradient
          colors={['rgba(26,69,152,0.92)', 'rgba(0,191,165,0.92)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />

        <Animated.View
          style={[
            styles.card,
            { transform: [{ scale: scaleAnim }, { scale: pulseAnim }] },
          ]}
        >
          {/* Logo */}
          <View style={styles.logoRow}>
            <DawaLogo size={52} />
            <Text style={styles.brandName}>
              CARE<Text style={styles.brandHub}>HUB</Text>
            </Text>
          </View>

          {/* Spinner */}
          <View style={styles.spinnerWrap}>
            <LoadingSpinner size={52} />
          </View>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.tagline}>TRUSTED CARE. ANYWHERE. ALWAYS.</Text>
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: 28,
    paddingHorizontal: 36,
    paddingVertical: 36,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    ...shadow('#000', 0, 12, 28, 0.25, 24),
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandName: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.inkBlack,
    letterSpacing: 1.5,
    marginTop: 8,
  },
  brandHub: {
    color: colors.tealGreen,
  },
  spinnerWrap: {
    marginBottom: 24,
  },
  message: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.inkBlack,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#9CA3AF',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
})
