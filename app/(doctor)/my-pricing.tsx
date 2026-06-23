import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

const TYPES = [
  { key: 'chat', icon: 'chatbubble-outline', label: 'Chat Consultation', desc: 'Real-time text, image and voice notes', color: colors.careBlue },
  { key: 'phone', icon: 'call-outline', label: 'Phone Consultation', desc: 'Audio-only call via Agora', color: colors.tealGreen },
  { key: 'video', icon: 'videocam-outline', label: 'Video Consultation', desc: 'Video call via Agora', color: colors.interactiveBlue },
] as const

export default function MyPricingScreen() {
  const { getToken } = useAuth()
  const router = useRouter()

  const [chatPrice, setChatPrice] = useState('')
  const [phonePrice, setPhonePrice] = useState('')
  const [videoPrice, setVideoPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getToken().then(async (token) => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('doctor_profiles')
        .select('chat_price, phone_price, video_price')
        .single()
      if (data) {
        setChatPrice(String((data as any).chat_price ?? ''))
        setPhonePrice(String((data as any).phone_price ?? ''))
        setVideoPrice(String((data as any).video_price ?? ''))
      }
    })
  }, [])

  const handleSave = async () => {
    const chatNum = Number(chatPrice)
    const phoneNum = Number(phonePrice)
    const videoNum = Number(videoPrice)
    if (isNaN(chatNum) || isNaN(phoneNum) || isNaN(videoNum) || chatNum < 0 || phoneNum < 0 || videoNum < 0) {
      Alert.alert('Invalid Prices', 'Please enter valid non-negative numbers for all prices.')
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('No token')
      await getAuthClient(token)
        .from('doctor_profiles')
        .update({ chat_price: chatNum, phone_price: phoneNum, video_price: videoNum })
      Alert.alert('Saved', 'Your consultation prices have been updated.')
      router.back()
    } catch {
      Alert.alert('Error', 'Failed to save prices. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const values: Record<string, string> = { chat: chatPrice, phone: phonePrice, video: videoPrice }
  const setters: Record<string, (v: string) => void> = { chat: setChatPrice, phone: setPhonePrice, video: setVideoPrice }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>My Pricing</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Info banner */}
          <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.banner}>
            <Ionicons name="pricetag" size={28} color={colors.mistWhite} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Set Your Rates</Text>
              <Text style={styles.bannerSub}>Prices are shown in ETB. Patients pay what you set.</Text>
            </View>
          </LinearGradient>

          {TYPES.map((type) => (
            <View key={type.key} style={styles.priceCard}>
              <View style={[styles.typeIconWrap, { backgroundColor: `${type.color}18` }]}>
                <Ionicons name={type.icon as never} size={24} color={type.color} />
              </View>
              <View style={styles.typeInfo}>
                <Text style={styles.typeLabel}>{type.label}</Text>
                <Text style={styles.typeDesc}>{type.desc}</Text>
              </View>
              <View style={styles.priceInputWrap}>
                <Text style={styles.currency}>ETB</Text>
                <TextInput
                  style={styles.priceInput}
                  value={values[type.key]}
                  onChangeText={setters[type.key]}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>
          ))}

          <Text style={styles.note}>
            Dawa takes a 20% platform fee from each consultation payment. The displayed price is what patients pay.
          </Text>

          <Pressable style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]} onPress={handleSave} disabled={saving}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveGrad}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Prices'}</Text>
            </LinearGradient>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  banner: { borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4) },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite, marginBottom: 2 },
  bannerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.85)' },

  priceCard: {
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  typeIconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  typeInfo: { flex: 1 },
  typeLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  typeDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.cloudGrey, borderRadius: 10, borderWidth: 1, borderColor: colors.steelGrey, paddingHorizontal: 10, height: 44 },
  currency: { fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280' },
  priceInput: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, minWidth: 60, textAlign: 'right' },

  note: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18, marginBottom: 20, marginTop: 4 },

  saveWrap: { borderRadius: 16, overflow: 'hidden' },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
