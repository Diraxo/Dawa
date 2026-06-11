import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorStore } from '@/store/doctorStore'

interface PriceCardProps {
  icon: string
  title: string
  description: string
  value: string
  onChange: (v: string) => void
}

function PriceCard({ icon, title, description, value, onChange }: PriceCardProps) {
  return (
    <View style={styles.priceCard}>
      <View style={styles.priceCardLeft}>
        <View style={styles.priceIconWrap}>
          <Text style={styles.priceIcon}>{icon}</Text>
        </View>
        <View style={styles.priceTextWrap}>
          <Text style={styles.priceTitle}>{title}</Text>
          <Text style={styles.priceDescription}>{description}</Text>
        </View>
      </View>
      <View style={styles.priceInputWrap}>
        <Text style={styles.currencySymbol}>ETB</Text>
        <TextInput
          style={styles.priceInput}
          placeholder="0"
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ''))}
          keyboardType="numeric"
          maxLength={6}
        />
      </View>
    </View>
  )
}

export default function RegistrationStep4() {
  const router = useRouter()
  const store = useDoctorStore()

  const [chatPrice, setChatPrice] = useState(store.regChatPrice)
  const [phonePrice, setPhonePrice] = useState(store.regPhonePrice)
  const [videoPrice, setVideoPrice] = useState(store.regVideoPrice)
  const [submitting, setSubmitting] = useState(false)

  const isValid = chatPrice.length > 0 && phonePrice.length > 0 && videoPrice.length > 0

  const handleSubmit = async () => {
    if (!isValid || submitting) return
    setSubmitting(true)
    store.updateReg({ regChatPrice: chatPrice, regPhonePrice: phonePrice, regVideoPrice: videoPrice })

    // TODO: Upload data + docs to Supabase and Clerk before navigating
    // For now navigate to under-review
    setTimeout(() => {
      setSubmitting(false)
      router.replace('/(doctor)/registration/under-review')
    }, 1200)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Top row */}
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
            </Pressable>
            <Text style={styles.stepLabel}>Step 4 of 4</Text>
          </View>

          <Text style={styles.title}>Set Consultation Prices</Text>

          {/* Progress bar - 100% */}
          <View style={styles.progressTrack}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.progressFull} />
          </View>

          {/* Revenue split note */}
          <View style={styles.revenueNote}>
            <Ionicons name="wallet-outline" size={18} color={colors.tealGreen} />
            <Text style={styles.revenueText}>
              You keep <Text style={styles.revenueBold}>80%</Text> of every consultation. CareHub takes a <Text style={styles.revenueBold}>20%</Text> platform fee.
            </Text>
          </View>

          {/* Price Cards */}
          <PriceCard
            icon="💬"
            title="Chat Consultation"
            description="Patients send text messages and photos"
            value={chatPrice}
            onChange={setChatPrice}
          />
          <PriceCard
            icon="📞"
            title="Phone Call"
            description="Audio-only call, works on slow internet"
            value={phonePrice}
            onChange={setPhonePrice}
          />
          <PriceCard
            icon="🎥"
            title="Video Call"
            description="Face-to-face consultation"
            value={videoPrice}
            onChange={setVideoPrice}
          />

          <Text style={styles.priceNote}>You can change your prices anytime from your profile settings</Text>

          {/* Earnings Preview */}
          {isValid && (
            <View style={styles.earningsCard}>
              <Text style={styles.earningsTitle}>Your Earnings Preview</Text>
              <Text style={styles.earningsSub}>After 20% platform fee</Text>
              {[
                { label: 'Chat', value: chatPrice, icon: '💬' },
                { label: 'Phone Call', value: phonePrice, icon: '📞' },
                { label: 'Video Call', value: videoPrice, icon: '🎥' },
              ].map(({ label, value, icon }) => {
                const net = value ? Math.floor(Number(value) * 0.8) : 0
                return (
                  <View key={label} style={styles.earningsRow}>
                    <Text style={styles.earningsIcon}>{icon}</Text>
                    <Text style={styles.earningsLabel}>{label}</Text>
                    <Text style={styles.earningsAmount}>ETB {net.toLocaleString()}</Text>
                    <Text style={styles.earningsNote}>per session</Text>
                  </View>
                )
              })}
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <View style={styles.backBtnWrap}>
              <OutlineButton label="← Back" onPress={() => router.back()} />
            </View>
            <View style={styles.submitBtnWrap}>
              <GradientButton
                label={submitting ? 'Submitting...' : 'Submit Application'}
                onPress={handleSubmit}
                disabled={!isValid || submitting}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingHorizontal: 24, paddingTop: 12 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  stepLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 16 },

  progressTrack: { height: 6, backgroundColor: colors.cloudGrey, borderRadius: 3, marginBottom: 20, overflow: 'hidden' },
  progressFull: { height: '100%', width: '100%', borderRadius: 3 },

  revenueNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#F0FDFB', borderRadius: 12, padding: 14, marginBottom: 24,
    borderWidth: 1, borderColor: '#CCFBF1',
  },
  revenueText: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkBlack, flex: 1, lineHeight: 18 },
  revenueBold: { fontFamily: fonts.bold, color: colors.tealGreen },

  priceCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.mistWhite, borderRadius: 16,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 16, marginBottom: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  priceCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceIconWrap: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center',
  },
  priceIcon: { fontSize: 22 },
  priceTextWrap: { flex: 1 },
  priceTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  priceDescription: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },

  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  currencySymbol: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },
  priceInput: {
    width: 80, borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack,
    textAlign: 'center',
  },

  priceNote: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  earningsCard: {
    backgroundColor: '#F0FDF4', borderRadius: 16, padding: 16, marginTop: 16,
    borderWidth: 1, borderColor: '#BBFBCD',
  },
  earningsTitle: { fontFamily: fonts.bold, fontSize: 15, color: '#15803D', marginBottom: 2 },
  earningsSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 12 },
  earningsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#DCFCE7' },
  earningsIcon: { fontSize: 16 },
  earningsLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkBlack, flex: 1 },
  earningsAmount: { fontFamily: fonts.bold, fontSize: 14, color: '#15803D' },
  earningsNote: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280' },

  footer: { paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  footerRow: { flexDirection: 'row', gap: 12 },
  backBtnWrap: { flex: 1 },
  submitBtnWrap: { flex: 2 },
})
