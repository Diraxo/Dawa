import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

const LAST_UPDATED = 'June 10, 2026'

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `We collect the following categories of personal information when you use Dawa:\n\n• Account Information: Your name, email address, phone number, and profile photo.\n• Health Information: Medical history, consultation notes, diagnoses, and uploaded health documents — provided voluntarily by you or your consulting doctor.\n• Device Information: Device identifiers, operating system version, and push notification tokens for app functionality.\n• Usage Data: Screens visited, features used, and session duration to improve the app experience.\n\nWe do not collect payment card information directly. Payment processing is handled by certified third-party processors (when enabled).`,
  },
  {
    title: '2. How We Use Your Information',
    body: `Your information is used exclusively to:\n\n• Provide and personalize your consultation experience.\n• Connect you with verified healthcare professionals.\n• Send appointment reminders and consultation summaries via push notification.\n• Improve app performance and resolve technical issues.\n• Comply with applicable laws and healthcare regulations.\n\nWe do not sell, rent, or share your personal or health data with advertisers.`,
  },
  {
    title: '3. Data Storage & Security',
    body: `All data is stored on Supabase-hosted infrastructure (PostgreSQL) with:\n\n• Row Level Security (RLS): Enforced on every database table so only authorized users can access their own records.\n• Encryption at Rest: All stored data is encrypted.\n• Encrypted Transmission: All data in transit uses TLS 1.2 or higher.\n• Authentication: Powered by Clerk, which follows SOC 2 Type II standards.\n\nConsultation conversations are routed through Stream Chat's encrypted messaging infrastructure.`,
  },
  {
    title: '4. Sharing of Information',
    body: `We only share your information in the following limited circumstances:\n\n• With the Doctor You Consult: The doctor you book receives your name and the consultation content during and after the session.\n• Service Providers: We use Clerk (auth), Supabase (database), Agora (calls), Stream Chat (messaging), and Firebase (notifications).\n• Legal Requirements: We may disclose information when required by law, court order, or to protect the safety of users.\n\nWe never sell your data to third parties.`,
  },
  {
    title: '5. Your Rights',
    body: `You have the right to:\n\n• Access: Request a copy of all personal data we hold about you.\n• Correction: Update incorrect or incomplete information via the Edit Profile screen.\n• Deletion: Permanently delete your account and all associated data.\n• Portability: Request your data in a machine-readable format by emailing privacy@dawa.app.\n• Withdrawal of Consent: You can revoke consent for non-essential data processing at any time.\n\nTo exercise these rights, contact us at privacy@dawa.app.`,
  },
  {
    title: '6. Age Requirements',
    body: `Healthcare professionals registering on Dawa must be at least 24 years old. This minimum reflects the age at which a person can realistically hold a recognised medical degree and be licensed to practice. Age is verified as part of the doctor application and document review process carried out by our admin team.\n\nDawa is not directed at persons under the age of 18. If we discover such a user, we will immediately suspend the account and delete all associated data.`,
  },
  {
    title: '7. Data Retention',
    body: `We retain your personal data for as long as your account is active. Upon account deletion, all personal data is removed within 30 days, except where we are required by law to retain certain records (e.g., financial transaction logs for tax compliance).`,
  },
  {
    title: '8. Changes to This Policy',
    body: `We may update this Privacy Policy periodically. When we make significant changes, we will notify you via push notification or email. Your continued use of Dawa after changes take effect constitutes acceptance of the updated policy.`,
  },
  {
    title: '9. Contact Us',
    body: `If you have questions, concerns, or requests about this Privacy Policy, please contact:\n\nDawa Privacy Team\nEmail: privacy@dawa.app\nSupport: support@dawa.app\nAddress: Addis Ababa, Ethiopia`,
  },
]

export default function DoctorPrivacyPolicyScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hero}>
          <Ionicons name="shield-checkmark" size={36} color={colors.mistWhite} />
          <View>
            <Text style={styles.heroTitle}>Privacy Policy</Text>
            <Text style={styles.heroSub}>Last updated: {LAST_UPDATED}</Text>
          </View>
        </LinearGradient>

        <Text style={styles.intro}>
          Dawa is committed to protecting your privacy and ensuring the security of your personal and health information. This Privacy Policy explains how we collect, use, and safeguard your data when you use our platform.
        </Text>

        {SECTIONS.map((sec) => (
          <View key={sec.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{sec.title}</Text>
            <Text style={styles.sectionBody}>{sec.body}</Text>
          </View>
        ))}

        <View style={styles.footer}>
          <Ionicons name="checkmark-circle" size={18} color={colors.tealGreen} />
          <Text style={styles.footerText}>This policy complies with GDPR, Google Play, and Apple App Store requirements.</Text>
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

  hero: { borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4) },
  heroTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite, marginBottom: 2 },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)' },

  intro: { fontFamily: fonts.regular, fontSize: 14, color: '#4B5563', lineHeight: 22, marginBottom: 20, backgroundColor: colors.mistWhite, borderRadius: 14, padding: 16, ...shadow('#000', 0, 1, 4, 0.04, 1) },

  section: { backgroundColor: colors.mistWhite, borderRadius: 14, padding: 16, marginBottom: 12, ...shadow('#000', 0, 1, 4, 0.04, 1) },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.inkBlack, marginBottom: 10 },
  sectionBody: { fontFamily: fonts.regular, fontSize: 13, color: '#4B5563', lineHeight: 21 },

  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F0FDFB', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: `${colors.tealGreen}30`, marginTop: 4 },
  footerText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: '#374151', lineHeight: 18 },
})
