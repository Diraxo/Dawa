import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, StyleSheet, Text } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

type Variant = 'outline' | 'teal' | 'blue'

type Props = {
  label: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  variant: Variant
  onPress: () => void
}

export function QuickActionCard({ label, icon, variant, onPress }: Props) {
  if (variant === 'outline') {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, styles.outlineCard, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={26} color={colors.tealGreen} />
        <Text style={[styles.label, styles.darkLabel]}>{label}</Text>
      </Pressable>
    )
  }

  const gradColors: [string, string] =
    variant === 'teal'
      ? [colors.tealGreen, '#008B7D']
      : [colors.careBlue, '#0D2462']

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={gradColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.solidCard}
      >
        <Ionicons name={icon} size={26} color={colors.mistWhite} />
        <Text style={[styles.label, styles.lightLabel]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  outlineCard: {
    backgroundColor: colors.mistWhite,
    borderWidth: 1.5,
    borderColor: colors.tealGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  solidCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  darkLabel: {
    color: colors.inkBlack,
  },
  lightLabel: {
    color: colors.mistWhite,
  },
  pressed: {
    opacity: 0.82,
  },
})
