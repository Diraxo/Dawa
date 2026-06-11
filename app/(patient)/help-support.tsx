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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

// ─── Data ─────────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string
  a: string
}

interface Section {
  id: string
  title: string
  items: FaqItem[]
}

const FAQ_SECTIONS: Section[] = [
  {
    id: 'general',
    title: 'Getting Started',
    items: [
      {
        q: 'What is CareHub?',
        a: 'CareHub is a doctor consultation platform that connects patients with verified healthcare professionals via chat, phone call, or video call — anytime, anywhere.',
      },
      {
        q: 'How do I book a consultation?',
        a: 'Go to the Doctors tab, choose a specialist, select a consultation type (chat, phone, or video), and tap Book. The doctor has 30 seconds to accept your request.',
      },
      {
        q: 'Is CareHub free to use?',
        a: 'Creating an account is free. Each consultation has a fee set by the doctor. Payment integration is coming soon.',
      },
    ],
  },
  {
    id: 'consultations',
    title: 'Consultations',
    items: [
      {
        q: 'What happens if the doctor does not respond?',
        a: 'If the doctor does not accept within 30 seconds, your request is automatically cancelled and you are notified. You can then book another available doctor.',
      },
      {
        q: 'How do I get a consultation summary?',
        a: 'After the consultation ends, the doctor fills in a summary including diagnosis, prescription notes, and follow-up recommendations. You receive a push notification when it is ready.',
      },
      {
        q: 'Can I see my past consultations?',
        a: 'Yes. All past consultations, summaries, and chat history are available in the Appointments tab.',
      },
      {
        q: 'Are my consultations private?',
        a: 'Yes. All conversations are end-to-end encrypted. Only you and your doctor can access the consultation content.',
      },
    ],
  },
  {
    id: 'doctors',
    title: 'Doctors & Verification',
    items: [
      {
        q: 'Are doctors on CareHub verified?',
        a: 'Yes. Every doctor submits their medical license, specialty credentials, and government-issued ID. Our admin team reviews and approves each application before they can practice on the platform.',
      },
      {
        q: 'How do I find the right doctor?',
        a: 'Use the Doctors tab to search by specialty, view ratings and reviews, and check availability in real time.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Account & Privacy',
    items: [
      {
        q: 'How do I change my password?',
        a: 'Password management is handled through your email provider. On the login screen, tap "Forgot password" to reset it.',
      },
      {
        q: 'How is my personal data stored?',
        a: 'Your data is stored securely on Supabase infrastructure with Row Level Security enforced on all tables. We never share your data with third parties without your consent.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Go to Profile → Delete Account. This permanently removes all your data from our systems. This action cannot be undone.',
      },
    ],
  },
]

const CONTACT_OPTIONS = [
  {
    icon: 'mail-outline',
    label: 'Email Support',
    value: 'support@carehub.app',
    action: () => Linking.openURL('mailto:support@carehub.app'),
  },
  {
    icon: 'logo-whatsapp',
    label: 'WhatsApp',
    value: '+251 900 000 000',
    action: () => Alert.alert('WhatsApp', 'WhatsApp support coming soon.'),
  },
]

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
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('general')

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
        <Text style={styles.headerTitle}>Help & Support</Text>
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
            <Text style={styles.heroTitle}>How can we help?</Text>
            <Text style={styles.heroSub}>Find answers or contact support below</Text>
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
        <Text style={styles.sectionLabel}>Contact Us</Text>
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

        {/* Privacy Policy */}
        <Text style={styles.sectionLabel}>Legal</Text>
        <View style={styles.card}>
          {[
            { label: 'Privacy Policy', onPress: () => router.push('/(patient)/privacy-policy' as any) },
            { label: 'Terms of Service', onPress: () => router.push('/(patient)/privacy-policy' as any) },
            { label: 'Legal Disclaimer', onPress: () => router.push('/(patient)/privacy-policy' as any) },
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
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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
