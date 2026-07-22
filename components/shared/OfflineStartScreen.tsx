import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors } from '@/constants/colors'
import { gradients } from '@/constants/gradients'
import { GradientButton } from '@/components/ui/GradientButton'
import { shadow } from '@/lib/shadow'

interface Props {
  onRetry: () => void
}

// Shown in place of the indefinite Clerk-loading spinner when the app is
// launched with no reachable network — mirrors ForceUpdateScreen's layout so
// it reads as the same "full-screen gate" pattern rather than a new design.
export default function OfflineStartScreen({ onRetry }: Props) {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topBar}
      />

      <View style={styles.content}>
        <LinearGradient
          colors={gradients.interactive}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconCircle}
        >
          <Text style={styles.iconEmoji}>📡</Text>
        </LinearGradient>

        <Text style={styles.title}>Connection unavailable</Text>

        <Text style={styles.message}>
          Please check your internet connection and try again.
        </Text>

        <View style={styles.button}>
          <GradientButton label="Retry" onPress={onRetry} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.mistWhite,
  },
  topBar: {
    height: 6,
    width: '100%',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    ...shadow('#2962FF', 0, 8, 16, 0.25, 8),
  },
  iconEmoji: {
    fontSize: 44,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 28,
    color: colors.inkBlack,
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  button: {
    width: '100%',
    marginBottom: 16,
  },
})
