import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { LayoutAnimation, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

interface FaqItem { q: string; a: string }
interface Section { id: string; title: string; items: FaqItem[] }

const FAQ_SECTIONS: Section[] = [
  {
    id: 'getting_started',
    title: 'Getting Started',
    items: [
      { q: 'How does my account get approved?', a: 'After completing registration with your medical license, credentials, and government ID, our admin team reviews your application within 24–48 hours. You will receive an email and in-app notification when approved.' },
      { q: 'What happens while I wait for approval?', a: 'Your account is locked until approval. You can log in and see your application status on the home and profile screens, but you cannot accept consultations or go online yet.' },
      { q: 'What if my application is rejected?', a: 'You will be notified of the reason for rejection. You can reapply with corrected or updated documents from the under-review screen.' },
    ],
  },
  {
    id: 'consultations',
    title: 'Consultations',
    items: [
      { q: 'How do I receive consultation requests?', a: 'Set yourself as online on your home screen. When a patient books with you, you receive a push notification and an in-app popup to accept or decline.' },
      { q: 'What if I miss a consultation request?', a: 'If you do not respond within a reasonable time, the request is automatically declined and the patient is notified. The consultation moves to your history as cancelled.' },
      { q: 'How do I end a consultation?', a: 'Tap the "End Consultation" button during any active session. You will then be prompted to fill in consultation notes including diagnosis, prescription notes, and follow-up recommendations.' },
      { q: 'Can patients schedule consultations?', a: 'Yes. During booking patients can choose on-demand (now) or schedule a specific date and time. Scheduled consultations appear in your Schedule tab.' },
    ],
  },
  {
    id: 'earnings',
    title: 'Earnings',
    items: [
      { q: 'How do I set my consultation fees?', a: 'Go to Profile → My Pricing to set your fees for chat, phone, and video consultations. Fees are shown in ETB.' },
      { q: 'How does the platform fee work?', a: 'Dawa takes a platform fee (currently 20%) from each completed consultation. The remainder is credited to your earnings balance — your exact split is shown in your Earnings Preview and pricing screen.' },
      { q: 'When can I withdraw my earnings?', a: 'Go to Profile → Withdraw Earnings. Enter your bank details and the amount, and our team will process the transfer within 1–3 business days.' },
    ],
  },
  {
    id: 'account',
    title: 'Account & Privacy',
    items: [
      { q: 'How do I update my profile or documents?', a: 'You can update your name, bio, hospital, and photo from Profile → Edit Profile. For document updates (license, ID), contact support as these require re-verification.' },
      { q: 'How is my data stored?', a: 'All data is stored securely with Row Level Security enforced on all database tables. We never share your data with third parties without your consent.' },
      { q: 'How do I delete my account?', a: 'Go to Profile → Delete Account. This permanently removes your personal information and documents and cannot be undone. Your past patients’ consultation records are kept for medical record-keeping, as described in our Privacy Policy.' },
    ],
  },
]

const CONTACT_OPTIONS = [
  { icon: 'mail-outline', label: 'Email Support', value: 'support@dawa.app', action: () => Linking.openURL('mailto:support@dawa.app') },
]

function FaqItem({ item, isOpen, onToggle }: { item: FaqItem; isOpen: boolean; onToggle: () => void }) {
  return (
    <View>
      <Pressable style={({ pressed }) => [styles.faqQ, pressed && { backgroundColor: '#F9FAFB' }]} onPress={onToggle}>
        <Text style={styles.faqQText}>{item.q}</Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.tealGreen} />
      </Pressable>
      {isOpen && <View style={styles.faqA}><Text style={styles.faqAText}>{item.a}</Text></View>}
    </View>
  )
}

export default function DoctorHelpSupportScreen() {
  const router = useRouter()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState('getting_started')

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setOpenKey((prev) => (prev === key ? null : key))
  }

  const currentSection = FAQ_SECTIONS.find((s) => s.id === activeSection)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.heroBanner}>
          <Ionicons name="help-buoy" size={36} color={colors.mistWhite} />
          <View>
            <Text style={styles.heroTitle}>How can we help?</Text>
            <Text style={styles.heroSub}>Find answers or contact support below</Text>
          </View>
        </LinearGradient>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {FAQ_SECTIONS.map((sec) => {
            const active = sec.id === activeSection
            return (
              <Pressable key={sec.id} style={[styles.tab, active && styles.tabActive]} onPress={() => { setActiveSection(sec.id); setOpenKey(null) }}>
                {active ? (
                  <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.tabGrad}>
                    <Text style={[styles.tabText, styles.tabTextActive]}>{sec.title}</Text>
                  </LinearGradient>
                ) : (
                  <Text style={styles.tabText}>{sec.title}</Text>
                )}
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={styles.card}>
          {currentSection?.items.map((item, idx) => {
            const key = `${activeSection}-${idx}`
            return (
              <View key={key}>
                <FaqItem item={item} isOpen={openKey === key} onToggle={() => toggle(key)} />
                {idx < (currentSection?.items.length ?? 0) - 1 && <View style={styles.divider} />}
              </View>
            )
          })}
        </View>

        <Text style={styles.sectionLabel}>Contact Us</Text>
        {CONTACT_OPTIONS.map((opt) => (
          <Pressable key={opt.label} style={({ pressed }) => [styles.contactCard, pressed && { opacity: 0.85 }]} onPress={opt.action}>
            <View style={styles.contactIcon}>
              <Ionicons name={opt.icon as never} size={22} color={colors.tealGreen} />
            </View>
            <View style={styles.contactText}>
              <Text style={styles.contactLabel}>{opt.label}</Text>
              <Text style={styles.contactValue}>{opt.value}</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.steelGrey} />
          </Pressable>
        ))}

        <Text style={styles.sectionLabel}>Legal</Text>
        <View style={styles.card}>
          {[
            { label: 'Privacy Policy', onPress: () => router.push('/(doctor)/privacy-policy' as never) },
            { label: 'Terms of Service', onPress: () => router.push('/(public)/terms' as never) },
          ].map((item, idx, arr) => (
            <View key={item.label}>
              <Pressable style={({ pressed }) => [styles.legalRow, pressed && { backgroundColor: '#F9FAFB' }]} onPress={item.onPress}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  heroBanner: { borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4) },
  heroTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite, marginBottom: 2 },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.85)' },

  tabRow: { paddingBottom: 16, gap: 8 },
  tab: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.mistWhite, borderWidth: 1, borderColor: colors.steelGrey },
  tabActive: { borderColor: 'transparent' },
  tabGrad: { paddingHorizontal: 16, paddingVertical: 8 },
  tabText: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280', paddingHorizontal: 16, paddingVertical: 8 },
  tabTextActive: { color: colors.mistWhite, paddingHorizontal: 0, paddingVertical: 0 },

  card: { backgroundColor: colors.mistWhite, borderRadius: 16, overflow: 'hidden', marginBottom: 20, ...shadow('#000', 0, 1, 5, 0.05, 2) },
  faqQ: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  faqQText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, flex: 1, lineHeight: 20 },
  faqA: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 0, backgroundColor: '#F9FAFB' },
  faqAText: { fontFamily: fonts.regular, fontSize: 13, color: '#4B5563', lineHeight: 20 },
  divider: { height: 1, backgroundColor: colors.cloudGrey },

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10, marginLeft: 4 },
  contactCard: { backgroundColor: colors.mistWhite, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10, ...shadow('#000', 0, 1, 4, 0.04, 1) },
  contactIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F0FDFB', alignItems: 'center', justifyContent: 'center' },
  contactText: { flex: 1 },
  contactLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  contactValue: { fontFamily: fonts.regular, fontSize: 13, color: colors.tealGreen },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 },
  legalText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
})
