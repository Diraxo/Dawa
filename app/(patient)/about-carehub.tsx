import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import Constants from 'expo-constants'

import { CareHubLogo } from '@/components/ui/CareHubLogo'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'

export default function AboutDawaScreen() {
  const router = useRouter()
  const { t } = useTranslation()

  const CORE_VALUES = [
    { icon: 'shield-checkmark', color: colors.tealGreen,      title: t('valueTrust'),         desc: t('valueTrustDesc') },
    { icon: 'globe',            color: colors.interactiveBlue, title: t('valueAccessibility'), desc: t('valueAccessibilityDesc') },
    { icon: 'lock-closed',      color: colors.careBlue,        title: t('valuePrivacy'),        desc: t('valuePrivacyDesc') },
    { icon: 'flash',            color: '#F59E0B',              title: t('valueSpeedTitle'),     desc: t('valueSpeedDesc') },
  ]

  const STATS = [
    { value: '500+', label: t('verifiedDoctors') },
    { value: '10K+', label: t('patientsServed') },
    { value: '4.9★', label: t('appRating') },
    { value: '3',    label: t('consultationTypes') },
  ]

  const HOW_STEPS = [
    t('howStep1'), t('howStep2'), t('howStep3'), t('howStep4'), t('howStep5'),
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('aboutDawaTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero banner */}
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.hero}
        >
          <View style={{ marginBottom: 14 }}>
            <CareHubLogo size={80} />
          </View>
          <Text style={styles.heroTagline}>TRUSTED CARE. ANYWHERE. ALWAYS.</Text>
          <Text style={styles.heroVersion}>{t('versionLabel')} {APP_VERSION}</Text>
        </LinearGradient>

        {/* Mission */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('missionLabel')}</Text>
          <Text style={styles.cardBody}>{t('missionBodyP1')}</Text>
          <Text style={[styles.cardBody, { marginTop: 10 }]}>{t('missionBodyP2')}</Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {STATS.map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Core values */}
        <Text style={styles.sectionLabel}>{t('coreValues')}</Text>
        {CORE_VALUES.map((val) => (
          <View key={val.title} style={styles.valueRow}>
            <View style={[styles.valueIcon, { backgroundColor: `${val.color}18` }]}>
              <Ionicons
                name={val.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={22}
                color={val.color}
              />
            </View>
            <View style={styles.valueText}>
              <Text style={styles.valueTitle}>{val.title}</Text>
              <Text style={styles.valueDesc}>{val.desc}</Text>
            </View>
          </View>
        ))}

        {/* How it works */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('howDawaWorks')}</Text>
          {HOW_STEPS.map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <LinearGradient
                colors={gradients.interactive}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.stepNum}
              >
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </LinearGradient>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Contact */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('contactInformation')}</Text>
          {[
            { icon: 'mail-outline',     text: 'support@dawa.app' },
            { icon: 'globe-outline',    text: 'www.dawa.app' },
            { icon: 'location-outline', text: 'Addis Ababa, Ethiopia' },
          ].map((item) => (
            <View key={item.text} style={styles.contactRow}>
              <Ionicons
                name={item.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={17}
                color={colors.tealGreen}
              />
              <Text style={styles.contactText}>{item.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.copyright}>{t('copyrightText', { year: new Date().getFullYear() })}</Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  hero: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    ...shadow(colors.careBlue, 0, 4, 12, 0.22, 5),
  },
  heroTagline: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroVersion: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.6)' },

  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, marginBottom: 10 },
  cardBody: { fontFamily: fonts.regular, fontSize: 14, color: '#4B5563', lineHeight: 22 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  statValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.tealGreen, marginBottom: 3 },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', textAlign: 'center' },

  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 12,
    marginLeft: 4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  valueIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  valueText: { flex: 1 },
  valueTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 4 },
  valueDesc: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', lineHeight: 19 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
  stepText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#4B5563', lineHeight: 20, paddingTop: 4 },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  contactText: { fontFamily: fonts.regular, fontSize: 14, color: '#374151' },

  copyright: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 8,
  },
})
