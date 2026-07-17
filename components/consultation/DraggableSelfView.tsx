import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import { Animated, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'

import { colors } from '@/constants/colors'
import { SpeakingPulse } from '@/components/consultation/SpeakingPulse'

const EDGE_MARGIN = 20
const PEEK_VISIBLE = 26

interface DraggableSelfViewProps {
  width?: number
  height?: number
  // Exactly one of top/bottom anchors the un-dragged resting position —
  // patient screens dock bottom-right (above the control bar), doctor
  // screens dock top-right (below the timer overlay).
  top?: number
  bottom?: number
  isOff: boolean
  isSpeaking?: boolean
  hidden?: boolean
  // Omit to disable tap-to-hide (a plain tap still pulls a peeked preview
  // back into view either way).
  onHide?: () => void
  children: React.ReactNode
}

// Shared WhatsApp-style local camera preview — small floating PiP, rounded
// corners, no border, no "You" label, freely draggable, and snaps to
// whichever screen edge it's released nearest with a chat-head-style "peek"
// tuck. One implementation for all 4 doctor/patient video screens so drag
// behavior can't drift between them (previously only the patient screen had
// any drag support at all).
export function DraggableSelfView({
  width = 90, height = 120, top, bottom, isOff, isSpeaking = false, hidden = false, onHide, children,
}: DraggableSelfViewProps) {
  const { width: screenWidth } = useWindowDimensions()
  // The PanResponder below is created once via useRef, so its handlers close
  // over whatever screenWidth was on first render — keep it live via a ref so
  // a rotation mid-call doesn't leave edge-docking using stale dimensions.
  const screenWidthRef = useRef(screenWidth)
  useEffect(() => { screenWidthRef.current = screenWidth }, [screenWidth])

  const [edge, setEdge] = useState<'left' | 'right' | null>(null)
  const [peeked, setPeeked] = useState(false)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  // pan.x is always relative to the resting position (flush against the
  // right edge) — so the same base offset works to compute a dock target
  // regardless of which edge it's currently docked to.
  const dock = (nextEdge: 'left' | 'right', peek: boolean) => {
    const sw = screenWidthRef.current
    const baseLeft = sw - EDGE_MARGIN - width
    const targetLeft = nextEdge === 'right'
      ? (peek ? sw - PEEK_VISIBLE : sw - EDGE_MARGIN - width)
      : (peek ? -(width - PEEK_VISIBLE) : EDGE_MARGIN)
    setEdge(nextEdge)
    setPeeked(peek)
    Animated.spring(pan.x, { toValue: targetLeft - baseLeft, useNativeDriver: false, bounciness: 6 }).start()
  }
  const dockRef = useRef(dock)
  useEffect(() => { dockRef.current = dock })

  // Tapping the (mostly off-screen) peeked sliver pulls it back into view;
  // otherwise a tap hides the preview if the caller opted in.
  const handleTap = () => {
    if (peeked && edge) { dock(edge, false); return }
    onHide?.()
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value })
        pan.setValue({ x: 0, y: 0 })
        setPeeked(false)
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset()
        const sw = screenWidthRef.current
        const baseLeft = sw - EDGE_MARGIN - width
        const currentLeft = baseLeft + (pan.x as any)._value
        // Only dock+peek if the preview actually ended up flush against a
        // screen edge — otherwise leave it exactly where it was dropped.
        if (currentLeft <= EDGE_MARGIN) dockRef.current('left', true)
        else if (currentLeft + width >= sw - EDGE_MARGIN) dockRef.current('right', true)
        else setEdge(null)
      },
    })
  ).current

  if (hidden) return null

  const anchorStyle = top != null ? { top } : { bottom: bottom ?? 20 }

  return (
    <Animated.View
      style={[
        styles.container,
        anchorStyle,
        { width, height, right: EDGE_MARGIN, transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
    >
      {/* The pulsing ring must live outside the clipped/rounded video box —
          overflow:hidden on the box below would otherwise clip the ring's
          outward scale-up animation. */}
      <SpeakingPulse active={isSpeaking} borderRadius={20} style={styles.fill}>
        <View style={styles.clip}>
          <Pressable style={styles.fill} onPress={handleTap}>
            {!isOff ? children : (
              <View style={styles.off}>
                <Ionicons name="videocam-off" size={22} color="rgba(255,255,255,0.5)" />
              </View>
            )}
            {peeked && edge && (
              <View style={[styles.peekTab, edge === 'right' ? styles.peekTabLeft : styles.peekTabRight]}>
                <Ionicons name={edge === 'right' ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.mistWhite} />
              </View>
            )}
          </Pressable>
        </View>
      </SpeakingPulse>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  clip: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1F2937',
  },
  fill: { flex: 1 },
  off: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  peekTab: {
    position: 'absolute', top: '50%', marginTop: -14,
    width: 26, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  peekTabLeft: { left: 0 },
  peekTabRight: { right: 0 },
})
