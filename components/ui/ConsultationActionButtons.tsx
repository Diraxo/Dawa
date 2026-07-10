import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

// Canonical Accept/Decline control used on every consultation approval
// screen (doctor dashboard, incoming request, phone/video ringing) so the
// affordance is identical across the app: green circle + check = accept,
// red circle + X = decline.

type Props = {
  onAccept: () => void
  onDecline: () => void
  acceptLabel?: string
  declineLabel?: string
  disabled?: boolean
  size?: number
}

export function ConsultationActionButtons({
  onAccept,
  onDecline,
  acceptLabel = 'Accept',
  declineLabel = 'Decline',
  disabled = false,
  size = 64,
}: Props) {
  const circleStyle = { width: size, height: size, borderRadius: size / 2 }

  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Pressable
          onPress={onDecline}
          disabled={disabled}
          style={[styles.circle, circleStyle, { backgroundColor: colors.error }]}
        >
          <Ionicons name="close" size={size * 0.44} color={colors.mistWhite} />
        </Pressable>
        <Text style={styles.label}>{declineLabel}</Text>
      </View>

      <View style={styles.column}>
        <Pressable
          onPress={onAccept}
          disabled={disabled}
          style={[styles.circle, circleStyle, { backgroundColor: colors.success }]}
        >
          <Ionicons name="checkmark" size={size * 0.44} color={colors.mistWhite} />
        </Pressable>
        <Text style={styles.label}>{acceptLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 40,
  },
  column: {
    alignItems: 'center',
    gap: 8,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.inkBlack,
  },
})
