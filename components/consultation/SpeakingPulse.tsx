import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native'

interface SpeakingPulseProps {
  active: boolean
  color?: string
  borderRadius?: number
  style?: ViewStyle
  children: React.ReactNode
}

// Shared "who's talking" ring — a soft pulsing border layered around a self
// view or a remote avatar. Driven purely by a boolean so both native video
// screens (doctor + patient) can wire it to Agora's audio volume indication
// without duplicating the animation.
export function SpeakingPulse({ active, color = '#00BFA5', borderRadius = 999, style, children }: SpeakingPulseProps) {
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(0)).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    animRef.current?.stop()
    if (!active) {
      scale.setValue(1)
      opacity.setValue(0)
      return
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.1, duration: 550, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 550, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 550, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 550, useNativeDriver: true }),
        ]),
      ])
    )
    animRef.current = anim
    anim.start()
    return () => anim.stop()
  }, [active])

  return (
    <View style={[styles.wrap, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.ring,
          { borderRadius, borderColor: color, opacity, transform: [{ scale }] },
        ]}
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  ring: { borderWidth: 3 },
})
