import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, View } from 'react-native'

import { colors } from '@/constants/colors'

type Props = {
  size?: number
}

// Shown only for admin-approved doctors (status === 'approved') — never for
// pending/rejected/suspended. Callers are responsible for that check; this
// component just renders the mark.
export function VerifiedBadge({ size = 16 }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="checkmark" size={size * 0.68} color={colors.mistWhite} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.careBlue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.mistWhite,
  },
})
