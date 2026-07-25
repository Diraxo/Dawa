import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

const LAST_UPDATED = 'July 17, 2026'

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `We collect the following categories of personal information when you use Dawa as a healthcare professional:\n\n• Account Information: Your name, email address, phone number, date of birth, gender, and profile photo.\n• Location Information: Your country, collected at registration to localize the app and connect you with patients in your region. We do not collect precise GPS location.\n• Professional & Verification Information: Medical license number, specialty, years of experience, hospital/clinic affiliation, and the medical license and government ID documents you upload for admin verification.\n• Health Information: Consultation notes, diagnoses, prescriptions, and consultation summary reports you create for patients you consult with.\n• Payment Information: Bank name and account number you provide to request a withdrawal of your earnings. We do not store patient payment card details — those are handled entirely by our payment processor, Chapa.\n• Device Information: Device identifiers, operating system version, and push notification tokens for app functionality.\n\nDawa does not use third-party analytics or crash-reporting SDKs, so we do not track which screens you visit, which features you use, or how long you use the app.`,
  },
  {
    title: '2. How We Use Your Information',
    body: `Your information is used exclusively to:\n\n• Verify your medical credentials and maintain your professional profile.\n• Connect you with patients and facilitate chat, voice, and video consultations.\n• Process your consultation earnings and withdrawal requests.\n• Send appointment reminders, consultation, and payment notifications via push notification.\n• Improve app performance and resolve technical issues.\n• Comply with applicable laws, medical licensing requirements, and healthcare regulations.\n\nWe do not sell, rent, or share your personal or health data with advertisers.`,
  },
  {
    title: '3. Data Storage & Security',
    body: `All data is stored on Supabase-hosted infrastructure (PostgreSQL) with:\n\n• Row Level Security (RLS): Enforced on every database table so only authorized users — you, the patient you're consulting with, and admins — can access relevant records.\n• Encryption at Rest: All stored data, including uploaded license/ID documents and consultation reports, is encrypted.\n• Encrypted Transmission: All data in transit uses TLS 1.2 or higher.\n• Authentication: Powered by Clerk, which follows SOC 2 Type II standards.\n\nConsultation text/voice-note messages are routed through Stream Chat's encrypted messaging infrastructure. Voice and video calls are routed through Agora's encrypted real-time communication infrastructure. Neither Agora nor Stream Chat retain call or message content beyond what's needed to deliver the session.`,
  },
  {
    title: '4. Sharing of Information',
    body: `We only share your information in the following limited circumstances:\n\n• With Patients You Consult: A patient who books you sees your name, photo, specialty, and the consultation content during and after the session.\n• Service Providers: We use Clerk (authentication), Supabase (database & file storage), Agora (voice/video calls), Stream Chat (messaging), Firebase (push notifications), and Chapa (payment processing for patient consultation fees).\n• Admin Review: License and ID documents you submit are visible to Dawa's admin team solely for verification purposes.\n• Legal Requirements: We may disclose information when required by law, court order, medical licensing authority request, or to protect the safety of users.\n\nWe never sell your data to third parties.`,
  },
  {
    title: '5. Your Rights',
    body: `Consistent with data protection principles including the EU General Data Protection Regulation (GDPR), you have the right to:\n\n• Access: Request a copy of all personal data we hold about you.\n• Rectification: Correct inaccurate or incomplete information via the Edit Profile screen, or by contacting us for fields that are locked pending admin review (e.g. license number, country).\n• Erasure: Permanently delete your account and associated personal data via Profile → Delete Account, subject to the retention exceptions in Section 8.\n• Portability: Request your data in a machine-readable format.\n• Restriction & Objection: Ask us to limit or object to certain processing of your data.\n• Withdrawal of Consent: Revoke consent for non-essential data processing at any time.\n\nTo exercise a right that isn't available directly in the app, email dawasupport@gmail.com and we will act on your request within 30 days. If you are located in the EEA/UK and believe we have not adequately addressed your request, you have the right to lodge a complaint with your local data protection supervisory authority.`,
  },
  {
    title: '6. Health Data Handling',
    body: `Health information you record — consultation notes, diagnoses, prescriptions, and summaries — is treated as a special, sensitive category of data. Access is restricted via Row Level Security to you, the specific patient the record belongs to, and Dawa admins only when necessary for platform safety or legal compliance. We apply administrative, technical, and physical safeguards modeled on recognized healthcare-privacy frameworks (such as the U.S. HIPAA Security Rule's safeguard categories), including encryption, access logging, and role-based access control, even outside jurisdictions where such frameworks apply directly. Health data is never used for advertising or shared with data brokers.`,
  },
  {
    title: '7. Age Requirements',
    body: `Healthcare professionals registering on Dawa must be at least 24 years old. This minimum reflects the age at which a person can realistically hold a recognised medical degree and be licensed to practice. Age is verified as part of the doctor application and document review process carried out by our admin team.\n\nDawa is not directed at persons under the age of 18. If we discover such a user, we will immediately suspend the account and delete all associated data.`,
  },
  {
    title: '8. Data Retention',
    body: `We retain your personal data for as long as your account is active. Upon account deletion, most personal data is removed within 30 days. We retain certain records longer where required by law or professional obligation — for example, financial/withdrawal transaction records for tax compliance, and consultation records that medical licensing or health authorities may require doctors and platforms to preserve for a minimum period after a consultation.`,
  },
  {
    title: '9. Third-Party Links',
    body: `Some screens (such as Help & Support or About Dawa) may link to external websites or services we don't control, such as our website or support channels. We are not responsible for the privacy practices of those third-party sites — please review their own privacy policies before providing information to them.`,
  },
  {
    title: '10. Changes to This Policy',
    body: `We may update this Privacy Policy periodically. When we make significant changes, we will notify you via push notification or email. Your continued use of Dawa after changes take effect constitutes acceptance of the updated policy.`,
  },
  {
    title: '11. Contact Us',
    body: `If you have questions, concerns, or requests about this Privacy Policy, please contact:\n\nDawa Privacy Team\nEmail: dawasupport@gmail.com\nAddress: Addis Ababa, Ethiopia`,
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
          <Text style={styles.footerText}>This policy is designed to meet Google Play and Apple App Store data-safety disclosure requirements, and to reflect GDPR principles and HIPAA-style safeguards for health data.</Text>
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
