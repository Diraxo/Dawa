import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { openSupportEmail } from '@/lib/whatsapp'

const LAST_UPDATED = 'July 17, 2026'

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
    title: 'INTRODUCTION',
    blocks: [
      {
        type: 'text',
        text: 'Dawa ("we", "our", "us") is committed to protecting your personal information and health data. This Privacy Policy explains how we collect, use, store, and protect your information when you use the Dawa mobile application and website.',
      },
    ],
  },
  {
    num: '2',
    title: 'INFORMATION WE COLLECT',
    blocks: [
      {
        type: 'subsection',
        label: 'Personal Information:',
        items: ['Full name, email address, phone number', 'Date of birth, gender', 'Profile photo'],
      },
      {
        type: 'subsection',
        label: 'Health Information:',
        items: [
          'Symptoms and health concerns you describe during consultations',
          'Consultation summaries, diagnoses, and prescriptions',
          'Medical records you choose to upload',
        ],
      },
      {
        type: 'subsection',
        label: 'Doctor Information (Healthcare Professionals only):',
        items: [
          'Medical license number and documents',
          'National ID or passport',
          'Specialty, hospital affiliation, years of experience',
        ],
      },
      {
        type: 'subsection',
        label: 'Technical Information:',
        items: [
          'Device type, operating system version, and push notification tokens',
          'Country selected at sign-up (used to localize the app)',
        ],
      },
      {
        type: 'subsection',
        label: 'Payment Information:',
        items: [
          'Consultation fees are processed by Chapa, our third-party payment processor. We do not collect or store your payment card details.',
          'Doctors provide bank account details to receive withdrawal payouts.',
        ],
      },
      {
        type: 'text',
        text: 'Dawa does not use third-party analytics or crash-reporting SDKs, so we do not track which screens you visit, which features you use, or how long you use the app.',
      },
    ],
  },
  {
    num: '3',
    title: 'HOW WE USE YOUR INFORMATION',
    blocks: [
      { type: 'text', text: 'We use your information to:' },
      {
        type: 'bullets',
        items: [
          'Connect you with verified healthcare professionals',
          'Facilitate chat, phone, and video consultations',
          'Send appointment reminders and consultation summaries',
          'Verify doctor credentials before approval',
          'Improve our services and user experience',
          'Comply with applicable laws and regulations',
        ],
      },
    ],
  },
  {
    num: '4',
    title: 'HOW WE PROTECT YOUR INFORMATION',
    blocks: [
      {
        type: 'bullets',
        items: [
          'All data is encrypted in transit using TLS 1.2 or higher',
          'All data is encrypted at rest using AES-256',
          'Health data is stored on secure Supabase servers',
          'Doctor documents are stored in encrypted file storage',
          'We never sell your personal or health data to third parties',
          'Access to your data is restricted to authorized Dawa staff only',
          'Consultation chats are private between patient and doctor only',
        ],
      },
    ],
  },
  {
    num: '5',
    title: 'DATA SHARING',
    blocks: [
      { type: 'text', text: 'We do NOT sell your data. We only share data with:' },
      {
        type: 'bullets',
        items: [
          'The doctor you consult with (only during your consultation)',
          'Supabase (our secure database provider)',
          'Clerk (our authentication provider)',
          'Agora (video/audio call infrastructure only — no health data shared)',
          'Stream (chat infrastructure only — messages are encrypted)',
          'Firebase (push notifications only — no health data shared)',
          'Chapa (payment processing for consultation fees — no health data shared)',
          'Law enforcement when required by law',
        ],
      },
    ],
  },
  {
    num: '6',
    title: 'YOUR RIGHTS',
    blocks: [
      { type: 'text', text: 'You have the right to:' },
      {
        type: 'bullets',
        items: [
          'Access your personal data at any time',
          'Correct inaccurate information',
          'Delete your account and personal information (consultation records are retained afterward for medical compliance — see Data Retention)',
          'Download your consultation history',
          'Opt out of non-essential communications',
        ],
      },
      { type: 'text', text: 'To exercise these rights, contact us at: dawasupport@gmail.com' },
    ],
  },
  {
    num: '7',
    title: 'DATA RETENTION',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Active account data: retained while your account is active',
          'Consultation records: retained for 5 years for medical compliance',
          'Deleted accounts: all personal data deleted within 30 days',
          'Doctor documents: deleted immediately if application is rejected',
        ],
      },
    ],
  },
  {
    num: '8',
    title: "CHILDREN'S PRIVACY",
    blocks: [
      {
        type: 'text',
        text: 'Dawa requires all patient accounts to belong to someone 18 years of age or older and all doctor accounts to belong to someone 24 years of age or older — we do not offer parental- or guardian-consent accounts for minors. Dawa is not directed at children, and we do not knowingly collect personal information from anyone under 18. If we learn that a minor has created an account, we will suspend it and delete the associated data.',
      },
    ],
  },
  {
    num: '9',
    title: 'COOKIES AND TRACKING (Website only)',
    blocks: [
      {
        type: 'text',
        text: 'Our website uses only essential cookies for authentication and session management. We do not use advertising cookies or tracking pixels.',
      },
    ],
  },
  {
    num: '10',
    title: 'CHANGES TO THIS POLICY',
    blocks: [
      {
        type: 'text',
        text: 'We will notify you of significant changes via email and in-app notification at least 30 days before changes take effect.',
      },
    ],
  },
  {
    num: '11',
    title: 'CONTACT US',
    blocks: [
      {
        type: 'text',
        text: 'Dawa Support Team\nEmail: dawasupport@gmail.com\nWebsite: www.dawa.app/privacy',
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

export default function PrivacyPolicyScreen() {
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
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Privacy Policy</Text>
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
          onPress={() => openSupportEmail()}
        >
          <Ionicons name="mail-outline" size={18} color={colors.tealGreen} />
          <Text style={styles.footerText}>
            Contact us:{' '}
            <Text style={styles.footerLink}>dawasupport@gmail.com</Text>
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
