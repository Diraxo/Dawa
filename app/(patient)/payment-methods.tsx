import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'

export default function PaymentMethodsScreen() {
  const router = useRouter()

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
        <Text style={styles.headerTitle}>Payment Methods</Text>
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
          <Text style={styles.heroTitle}>Payments Coming Soon</Text>
          <Text style={styles.heroSub}>
            Secure online payment integration is currently in development. You will be able to manage
            saved cards, mobile wallets, and more.
          </Text>
          <View style={styles.featurePill}>
            <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.featurePillText}>Bank-grade Security</Text>
          </View>
        </LinearGradient>

        {/* Placeholder features */}
        {[
          { icon: 'card-outline', title: 'Credit / Debit Cards', sub: 'Visa, Mastercard, Amex' },
          { icon: 'phone-portrait-outline', title: 'Mobile Money', sub: 'M-PESA, Telebirr, Airtel' },
          { icon: 'wallet-outline', title: 'Digital Wallets', sub: 'Apple Pay, Google Pay' },
          { icon: 'cash-outline', title: 'Bank Transfer', sub: 'Direct bank payment' },
        ].map((item) => (
          <Pressable
            key={item.title}
            style={({ pressed }) => [styles.featureRow, pressed && { opacity: 0.7 }]}
            onPress={() => Alert.alert('Coming Soon', 'This payment method will be available soon.')}
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
            <View style={styles.soonBadge}>
              <Text style={styles.soonText}>Soon</Text>
            </View>
          </Pressable>
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
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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
