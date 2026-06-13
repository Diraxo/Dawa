import { Linking, Platform, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Constants from 'expo-constants'
import { colors } from '@/constants/colors'
import { gradients } from '@/constants/gradients'
import { GradientButton } from '@/components/ui/GradientButton'

interface Props {
  message?: string
  storeUrl?: string
  latestVersion?: string
}

export default function ForceUpdateScreen({
  message = 'A new version of CareHub is available. Please update to continue using the app.',
  storeUrl = Platform.OS === 'ios'
    ? 'https://apps.apple.com/app/carehub'
    : 'https://play.google.com/store/apps/details?id=com.carehub',
  latestVersion = '',
}: Props) {
  const currentVersion = Constants.expoConfig?.version ?? ''

  const handleUpdate = () => {
    Linking.openURL(storeUrl)
  }

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
          <Text style={styles.iconEmoji}>🔄</Text>
        </LinearGradient>

        <Text style={styles.title}>Update Required</Text>

        <Text style={styles.message}>{message}</Text>

        {(currentVersion || latestVersion) ? (
          <View style={styles.versionRow}>
            {currentVersion ? (
              <View style={styles.versionBadge}>
                <Text style={styles.versionLabel}>Current</Text>
                <Text style={styles.versionNumber}>v{currentVersion}</Text>
              </View>
            ) : null}
            {latestVersion ? (
              <>
                <Text style={styles.arrow}>→</Text>
                <View style={[styles.versionBadge, styles.versionBadgeNew]}>
                  <Text style={[styles.versionLabel, styles.versionLabelNew]}>Latest</Text>
                  <Text style={[styles.versionNumber, styles.versionNumberNew]}>v{latestVersion}</Text>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.button}>
          <GradientButton label="Update Now" onPress={handleUpdate} />
        </View>

        <Text style={styles.footnote}>
          You must update to continue using CareHub.
        </Text>
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
    shadowColor: '#2962FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
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
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 36,
  },
  versionBadge: {
    backgroundColor: colors.cloudGrey,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  versionBadgeNew: {
    backgroundColor: '#E8F5F2',
  },
  versionLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 11,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  versionLabelNew: {
    color: colors.tealGreen,
  },
  versionNumber: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 16,
    color: colors.inkBlack,
    marginTop: 2,
  },
  versionNumberNew: {
    color: colors.tealGreen,
  },
  arrow: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 20,
    color: colors.steelGrey,
  },
  button: {
    width: '100%',
    marginBottom: 16,
  },
  footnote: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
})
