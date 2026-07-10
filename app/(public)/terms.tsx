import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

const LAST_UPDATED = 'June 2025'

type Block =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'subsection'; label: string; items: string[] }

interface Section {
  num: string
  title: string
  blocks: Block[]
}

const SECTIONS: Section[] = [
  {
    num: '1',
    title: 'ACCEPTANCE OF TERMS',
    blocks: [
      {
        type: 'text',
        text: 'By using Dawa, you agree to these Terms of Service. If you do not agree, please do not use our services.',
      },
    ],
  },
  {
    num: '2',
    title: 'DESCRIPTION OF SERVICE',
    blocks: [
      {
        type: 'text',
        text: 'Dawa is a telemedicine platform that connects patients with verified healthcare professionals for remote consultations via chat, phone call, and video call.',
      },
      {
        type: 'text',
        text: 'Dawa does NOT provide emergency medical services. If you have a medical emergency, call your local emergency number immediately.',
      },
    ],
  },
  {
    num: '3',
    title: 'MEDICAL DISCLAIMER',
    blocks: [
      {
        type: 'text',
        text: 'IMPORTANT: Dawa consultations are not a substitute for in-person emergency care. Doctors on Dawa provide general medical advice and consultations only. For any life-threatening condition, go to your nearest hospital or call emergency services immediately.',
      },
    ],
  },
  {
    num: '4',
    title: 'USER ACCOUNTS',
    blocks: [
      {
        type: 'subsection',
        label: 'Patients:',
        items: [
          'You must provide accurate personal information',
          'You are responsible for keeping your account secure',
          'You must be 18 or older, or have parental consent',
          'One account per person',
        ],
      },
      {
        type: 'subsection',
        label: 'Healthcare Professionals:',
        items: [
          'You must hold a valid medical license in your country',
          'You must provide authentic documents during registration',
          'Providing false credentials will result in permanent ban and may be reported to medical authorities',
          'You are responsible for the medical advice you provide',
          'You must maintain your own professional liability insurance',
        ],
      },
    ],
  },
  {
    num: '5',
    title: 'CONSULTATION RULES',
    blocks: [
      {
        type: 'subsection',
        label: 'For Patients:',
        items: [
          'Be respectful to healthcare professionals',
          'Provide accurate health information',
          'Do not misuse the platform for non-medical purposes',
          'Payments are processed before consultations begin',
        ],
      },
      {
        type: 'subsection',
        label: 'For Doctors:',
        items: [
          'You must respond to consultation requests in a timely manner',
          'You must provide professional, ethical medical advice',
          'You must complete consultation notes after each session',
          'You cannot solicit patients outside the platform',
        ],
      },
    ],
  },
  {
    num: '6',
    title: 'PAYMENTS AND REFUNDS',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Consultation fees are charged per session',
          'Dawa takes a 20% platform commission',
          'Doctors receive 80% of each consultation fee',
          'Refunds are available if a doctor does not respond to a request within a reasonable time',
          'Refunds are NOT available once a consultation has started',
          'Withdrawal requests are processed within 3-5 business days',
        ],
      },
    ],
  },
  {
    num: '7',
    title: 'PROHIBITED USES',
    blocks: [
      { type: 'text', text: 'You may NOT use Dawa to:' },
      {
        type: 'bullets',
        items: [
          'Provide or receive emergency medical care',
          'Share false or misleading health information',
          'Harass or abuse other users',
          'Attempt to contact doctors outside the platform',
          'Upload illegal or inappropriate content',
          'Violate any applicable laws or regulations',
        ],
      },
    ],
  },
  {
    num: '8',
    title: 'INTELLECTUAL PROPERTY',
    blocks: [
      {
        type: 'text',
        text: 'All Dawa content, logo, design, and software are owned by Dawa and protected by copyright law. You may not copy, modify, or distribute our content without permission.',
      },
    ],
  },
  {
    num: '9',
    title: 'LIMITATION OF LIABILITY',
    blocks: [
      {
        type: 'text',
        text: 'Dawa is a platform connecting patients and doctors. We are not liable for the medical advice provided by doctors on our platform. Doctors are independent healthcare professionals, not Dawa employees.',
      },
    ],
  },
  {
    num: '10',
    title: 'TERMINATION',
    blocks: [
      {
        type: 'text',
        text: 'We reserve the right to suspend or terminate accounts that violate these terms, without prior notice.',
      },
    ],
  },
  {
    num: '11',
    title: 'GOVERNING LAW',
    blocks: [
      {
        type: 'text',
        text: 'These terms are governed by the laws of Ethiopia. Disputes will be resolved in Ethiopian courts.',
      },
    ],
  },
  {
    num: '12',
    title: 'CONTACT',
    blocks: [
      {
        type: 'text',
        text: 'For questions about these terms:\nEmail: legal@dawa.app\nWebsite: www.dawa.app/terms',
      },
    ],
  },
]

function renderBlock(block: Block, idx: number) {
  if (block.type === 'text') {
    return (
      <Text key={idx} style={styles.body}>
        {block.text}
      </Text>
    )
  }
  if (block.type === 'bullets') {
    return (
      <View key={idx} style={styles.list}>
        {block.items.map((item, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
    )
  }
  if (block.type === 'subsection') {
    return (
      <View key={idx} style={styles.subsection}>
        <Text style={styles.subsectionLabel}>{block.label}</Text>
        {block.items.map((item, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
    )
  }
  return null
}

export default function TermsScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/sign-up' as never)}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Terms of Service</Text>
        <Text style={styles.lastUpdated}>Last updated: {LAST_UPDATED}</Text>

        {SECTIONS.map((sec, sectionIdx) => (
          <View key={sec.num}>
            {sectionIdx > 0 && <View style={styles.divider} />}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {sec.num}. {sec.title}
              </Text>
              {sec.blocks.map((block, blockIdx) => renderBlock(block, blockIdx))}
            </View>
          </View>
        ))}

        <View style={styles.divider} />

        <Pressable
          style={({ pressed }) => [styles.footerCard, pressed && { opacity: 0.8 }]}
          onPress={() => Linking.openURL('mailto:legal@dawa.app')}
        >
          <Ionicons name="mail-outline" size={18} color={colors.tealGreen} />
          <Text style={styles.footerText}>
            Contact us:{' '}
            <Text style={styles.footerLink}>legal@dawa.app</Text>
          </Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.steelGrey,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack },

  pageTitle: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: colors.inkBlack,
    lineHeight: 40,
    marginTop: 24,
    marginBottom: 6,
  },
  lastUpdated: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 8,
  },

  divider: { height: 1, backgroundColor: colors.steelGrey },

  section: { paddingVertical: 20 },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 20,
    color: colors.tealGreen,
    lineHeight: 26,
    marginBottom: 12,
  },

  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    lineHeight: 26,
    marginBottom: 8,
  },

  list: { marginTop: 2, marginBottom: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 },
  bullet: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.tealGreen,
    marginRight: 10,
    lineHeight: 26,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    lineHeight: 26,
  },

  subsection: { marginBottom: 14 },
  subsectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.inkBlack,
    marginBottom: 6,
    lineHeight: 20,
  },

  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: `${colors.tealGreen}12`,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: `${colors.tealGreen}30`,
    marginTop: 20,
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    lineHeight: 20,
  },
  footerLink: {
    fontFamily: fonts.semiBold,
    color: colors.tealGreen,
  },
})
