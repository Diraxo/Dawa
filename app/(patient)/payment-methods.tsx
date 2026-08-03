import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

export default function PaymentMethodsScreen() {
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('paymentMethodsTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Coming soon hero */}
      <View style={styles.body}>
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.heroCard}
        >
          <View style={styles.heroIconWrap}>
            <Ionicons name="card" size={40} color={colors.mistWhite} />
          </View>
          <Text style={styles.heroTitle}>{t('paymentComingSoon')}</Text>
          <Text style={styles.heroSub}>{t('paymentComingSoonDesc')}</Text>
          <View style={styles.featurePill}>
            <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.featurePillText}>Bank-grade Security</Text>
          </View>
        </LinearGradient>

        {/* How payments work */}
        {[
          { icon: 'shield-checkmark-outline', title: 'Secure Checkout via Chapa', sub: 'Payments are processed at the time of booking using Chapa, Ethiopia\'s trusted payment gateway.' },
          { icon: 'card-outline', title: 'Accepted Methods', sub: 'Telebirr, CBE Birr, Amole, HelloCash, and major debit/credit cards via Chapa.' },
          { icon: 'receipt-outline', title: 'Automatic Receipts', sub: 'A receipt is sent to your email after each payment.' },
          { icon: 'lock-closed-outline', title: 'Bank-grade Security', sub: 'Your payment details are never stored on our servers. All transactions are encrypted.' },
        ].map((item) => (
          <View
            key={item.title}
            style={styles.featureRow}
          >
            <View style={styles.featureIcon}>
              <Ionicons
                name={item.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={22}
                color={colors.tealGreen}
              />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{item.title}</Text>
              <Text style={styles.featureSub}>{item.sub}</Text>
            </View>
          </View>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },

  heroCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
    ...shadow(colors.careBlue, 0, 4, 12, 0.22, 5),
  },
  heroIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.mistWhite,
    marginBottom: 10,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  featurePillText: { fontFamily: fonts.semiBold, fontSize: 13, color: 'rgba(255,255,255,0.95)' },

  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1 },
  featureTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  featureSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  soonBadge: {
    backgroundColor: `${colors.warning}22`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  soonText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.warning },
})
