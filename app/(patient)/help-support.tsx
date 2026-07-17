import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string
  a: string
}

interface Section {
  id: string
  title: string
  items: FaqItem[]
}

// ─── FaqAccordionItem ─────────────────────────────────────────────────────────

function FaqAccordionItem({ item, isOpen, onToggle }: {
  item: FaqItem
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <View>
      <Pressable
        style={({ pressed }) => [styles.faqQ, pressed && { backgroundColor: '#F9FAFB' }]}
        onPress={onToggle}
      >
        <Text style={styles.faqQText}>{item.q}</Text>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={17}
          color={colors.tealGreen}
        />
      </Pressable>
      {isOpen && (
        <View style={styles.faqA}>
          <Text style={styles.faqAText}>{item.a}</Text>
        </View>
      )}
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HelpSupportScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('general')

  const FAQ_SECTIONS: Section[] = [
    {
      id: 'general',
      title: t('faqGettingStarted'),
      items: [
        { q: t('faqQ_whatIsDawa'),  a: t('faqA_whatIsDawa') },
        { q: t('faqQ_howToBook'),   a: t('faqA_howToBook') },
        { q: t('faqQ_isFree'),      a: t('faqA_isFree') },
      ],
    },
    {
      id: 'consultations',
      title: t('faqConsultations'),
      items: [
        { q: t('faqQ_doctorNoResponse'), a: t('faqA_doctorNoResponse') },
        { q: t('faqQ_getSummary'),       a: t('faqA_getSummary') },
        { q: t('faqQ_pastConsultations'),a: t('faqA_pastConsultations') },
        { q: t('faqQ_arePrivate'),       a: t('faqA_arePrivate') },
      ],
    },
    {
      id: 'doctors',
      title: t('faqDoctorsVerification'),
      items: [
        { q: t('faqQ_areVerified'), a: t('faqA_areVerified') },
        { q: t('faqQ_findDoctor'),  a: t('faqA_findDoctor') },
      ],
    },
    {
      id: 'account',
      title: t('faqAccountPrivacy'),
      items: [
        { q: t('faqQ_changePassword'), a: t('faqA_changePassword') },
        { q: t('faqQ_dataStorage'),    a: t('faqA_dataStorage') },
        { q: t('faqQ_deleteAccount'),  a: t('faqA_deleteAccount') },
      ],
    },
  ]

  const CONTACT_OPTIONS = [
    {
      icon: 'mail-outline',
      label: t('emailSupport'),
      value: 'support@dawa.app',
      action: () => Linking.openURL('mailto:support@dawa.app'),
    },
  ]

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setOpenKey((prev) => (prev === key ? null : key))
  }

  const currentSection = FAQ_SECTIONS.find((s) => s.id === activeSection)

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
        <Text style={styles.headerTitle}>{t('helpSupport')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.heroBanner}
        >
          <Ionicons name="help-buoy" size={36} color={colors.mistWhite} />
          <View>
            <Text style={styles.heroTitle}>{t('howCanWeHelp')}</Text>
            <Text style={styles.heroSub}>{t('findAnswersBelow')}</Text>
          </View>
        </LinearGradient>

        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
        >
          {FAQ_SECTIONS.map((sec) => {
            const active = sec.id === activeSection
            return (
              <Pressable
                key={sec.id}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => { setActiveSection(sec.id); setOpenKey(null) }}
              >
                {active ? (
                  <LinearGradient
                    colors={gradients.interactive}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.tabGrad}
                  >
                    <Text style={[styles.tabText, styles.tabTextActive]}>{sec.title}</Text>
                  </LinearGradient>
                ) : (
                  <Text style={styles.tabText}>{sec.title}</Text>
                )}
              </Pressable>
            )
          })}
        </ScrollView>

        {/* FAQ accordion */}
        <View style={styles.card}>
          {currentSection?.items.map((item, idx) => {
            const key = `${activeSection}-${idx}`
            return (
              <View key={key}>
                <FaqAccordionItem
                  item={item}
                  isOpen={openKey === key}
                  onToggle={() => toggle(key)}
                />
                {idx < (currentSection?.items.length ?? 0) - 1 && (
                  <View style={styles.divider} />
                )}
              </View>
            )
          })}
        </View>

        {/* Contact Support */}
        <Text style={styles.sectionLabel}>{t('contactUs')}</Text>
        {CONTACT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.label}
            style={({ pressed }) => [styles.contactCard, pressed && { opacity: 0.85 }]}
            onPress={opt.action}
          >
            <View style={styles.contactIcon}>
              <Ionicons
                name={opt.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={22}
                color={colors.tealGreen}
              />
            </View>
            <View style={styles.contactText}>
              <Text style={styles.contactLabel}>{opt.label}</Text>
              <Text style={styles.contactValue}>{opt.value}</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.steelGrey} />
          </Pressable>
        ))}

        {/* Legal */}
        <Text style={styles.sectionLabel}>{t('legal')}</Text>
        <View style={styles.card}>
          {[
            { label: t('privacyPolicy'),  onPress: () => router.push('/(patient)/privacy-policy' as any) },
            { label: t('termsOfService'), onPress: () => router.push('/(public)/terms' as any) },
            { label: t('legalDisclaimer'),onPress: () => router.push('/(public)/terms' as any) },
          ].map((item, idx, arr) => (
            <View key={item.label}>
              <Pressable
                style={({ pressed }) => [styles.legalRow, pressed && { backgroundColor: '#F9FAFB' }]}
                onPress={item.onPress}
              >
                <Text style={styles.legalText}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={17} color={colors.steelGrey} />
              </Pressable>
              {idx < arr.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  heroBanner: {
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4),
  },
  heroTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite, marginBottom: 2 },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.85)' },

  tabRow: { paddingBottom: 16, gap: 8 },
  tab: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.mistWhite,
    borderWidth: 1,
    borderColor: colors.steelGrey,
  },
  tabActive: { borderColor: 'transparent' },
  tabGrad: { paddingHorizontal: 16, paddingVertical: 8 },
  tabText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabTextActive: { color: colors.mistWhite, paddingHorizontal: 0, paddingVertical: 0 },

  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  faqQ: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  faqQText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.inkBlack,
    flex: 1,
    lineHeight: 20,
  },
  faqA: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 0,
    backgroundColor: '#F9FAFB',
  },
  faqAText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
  },
  divider: { height: 1, backgroundColor: colors.cloudGrey },

  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
    marginLeft: 4,
  },
  contactCard: {
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  contactIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactText: { flex: 1 },
  contactLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  contactValue: { fontFamily: fonts.regular, fontSize: 13, color: colors.tealGreen },

  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  legalText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
})
