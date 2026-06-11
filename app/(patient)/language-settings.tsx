import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n'
import { useAppStore } from '@/store/appStore'

// ─── Constants ────────────────────────────────────────────────────────────────

export interface Language {
  code: string
  name: string
  nativeName: string
  flag: string
  region: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', region: 'United States' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', flag: '🇪🇹', region: 'Ethiopia' },
  { code: 'om', name: 'Afaan Oromoo', nativeName: 'Afaan Oromoo', flag: '🇪🇹', region: 'Ethiopia' },
  { code: 'ti', name: 'Tigrinya', nativeName: 'ትግርኛ', flag: '🇪🇷', region: 'Eritrea / Ethiopia' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali', flag: '🇸🇴', region: 'Somalia' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', region: 'Middle East' },
]

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LanguageSettingsScreen() {
  const router = useRouter()
  const { setSelectedLanguage } = useAppStore()
  const [selected, setSelected] = useState(i18n.language ?? 'en')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((code) => {
      if (code) setSelected(code)
    })
  }, [])

  const handleSelect = (code: string) => {
    setSelected(code)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      setSelectedLanguage(selected)
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, selected)
      Alert.alert('Language Updated', `App language set to ${LANGUAGES.find((l) => l.code === selected)?.name}.`, [
        { text: 'OK', onPress: () => router.back() },
      ])
    } catch {
      Alert.alert('Error', 'Failed to change language. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const currentLang = LANGUAGES.find((l) => l.code === selected)

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
        <Text style={styles.headerTitle}>Language</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Current language banner */}
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.banner}
        >
          <Text style={styles.bannerFlag}>{currentLang?.flag}</Text>
          <View>
            <Text style={styles.bannerTitle}>{currentLang?.nativeName}</Text>
            <Text style={styles.bannerSub}>
              {currentLang?.name} · {currentLang?.region}
            </Text>
          </View>
        </LinearGradient>

        <Text style={styles.sectionLabel}>Select Language</Text>

        <View style={styles.card}>
          {LANGUAGES.map((lang, idx) => {
            const isSelected = lang.code === selected
            return (
              <View key={lang.code}>
                <Pressable
                  style={({ pressed }) => [
                    styles.langRow,
                    pressed && { backgroundColor: '#F9FAFB' },
                  ]}
                  onPress={() => handleSelect(lang.code)}
                >
                  <Text style={styles.langFlag}>{lang.flag}</Text>
                  <View style={styles.langTextWrap}>
                    <Text style={[styles.langName, isSelected && styles.langNameSel]}>
                      {lang.nativeName}
                    </Text>
                    <Text style={styles.langSub}>
                      {lang.name} · {lang.region}
                    </Text>
                  </View>
                  {isSelected ? (
                    <LinearGradient
                      colors={gradients.interactive}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.checkCircle}
                    >
                      <Ionicons name="checkmark" size={14} color={colors.mistWhite} />
                    </LinearGradient>
                  ) : (
                    <View style={styles.emptyCircle} />
                  )}
                </Pressable>
                {idx < LANGUAGES.length - 1 && <View style={styles.divider} />}
              </View>
            )
          })}
        </View>

        <Text style={styles.note}>
          Language changes apply throughout the entire app. Some content may remain in English
          while translations are being expanded.
        </Text>

        {/* Save button */}
        <Pressable
          style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.saveGrad}
          >
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Language'}</Text>
          </LinearGradient>
        </Pressable>

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

  banner: {
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  bannerFlag: { fontSize: 40 },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, marginBottom: 2 },
  bannerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.85)' },

  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  langFlag: { fontSize: 28 },
  langTextWrap: { flex: 1 },
  langName: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.inkBlack,
    marginBottom: 2,
  },
  langNameSel: { color: colors.tealGreen },
  langSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.steelGrey,
  },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 68 },

  note: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  saveWrap: { borderRadius: 16, overflow: 'hidden' },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
