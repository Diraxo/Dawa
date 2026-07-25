import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { AlertVariant, CareHubAlert } from '@/components/ui/CareHubAlert'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { LANGUAGES } from '@/constants/languages'
import { shadow } from '@/lib/shadow'
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n'
import { useAppStore } from '@/store/appStore'

export default function DoctorLanguageSettingsScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { setSelectedLanguage } = useAppStore()
  const [selected, setSelected] = useState(i18n.language ?? 'en')
  const [saving, setSaving] = useState(false)
  const [alertState, setAlertState] = useState<{ variant: AlertVariant; title: string; message: string; onOk?: () => void } | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((code) => {
      if (code) {
        setSelected(code)
        i18n.changeLanguage(code)
      }
    })
  }, [])

  const handleSelect = (code: string) => {
    setSelected(code)
    i18n.changeLanguage(code)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      setSelectedLanguage(selected)
      await i18n.changeLanguage(selected)
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, selected)
      setAlertState({
        variant: 'success',
        title: 'Language Updated',
        message: `App language set to ${LANGUAGES.find((l) => l.id === selected)?.nativeName}.`,
        onOk: () => router.back(),
      })
    } catch {
      setAlertState({ variant: 'error', title: 'Error', message: 'Failed to change language. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const currentLang = LANGUAGES.find((l) => l.id === selected)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('language')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.banner}>
          <Text style={styles.bannerTitle}>{currentLang?.nativeName}</Text>
        </LinearGradient>

        <Text style={styles.sectionLabel}>{t('selectLanguage')}</Text>
        <View style={styles.card}>
          {LANGUAGES.map((lang, idx) => {
            const isSelected = lang.id === selected
            return (
              <View key={lang.id}>
                <Pressable style={({ pressed }) => [styles.langRow, pressed && { backgroundColor: '#F9FAFB' }]} onPress={() => handleSelect(lang.id)}>
                  <View style={styles.langTextWrap}>
                    <Text style={[styles.langName, isSelected && styles.langNameSel]}>{lang.nativeName}</Text>
                  </View>
                  {isSelected ? (
                    <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.checkCircle}>
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

        <Text style={styles.note}>{t('languageNote')}</Text>

        <Pressable style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]} onPress={handleSave} disabled={saving}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveGrad}>
            <Text style={styles.saveText}>{saving ? t('saving') : t('saveLanguage')}</Text>
          </LinearGradient>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>

      <CareHubAlert
        visible={!!alertState}
        variant={alertState?.variant ?? 'info'}
        title={alertState?.title ?? ''}
        message={alertState?.message ?? ''}
        buttons={[{ text: 'OK', onPress: () => { const onOk = alertState?.onOk; setAlertState(null); onOk?.() } }]}
        onClose={() => setAlertState(null)}
      />
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

  banner: { borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4) },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, marginBottom: 2 },

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.mistWhite, borderRadius: 16, overflow: 'hidden', marginBottom: 16, ...shadow('#000', 0, 1, 5, 0.05, 2) },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  langTextWrap: { flex: 1 },
  langName: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, marginBottom: 2 },
  langNameSel: { color: colors.tealGreen },
  checkCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emptyCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.steelGrey },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 68 },

  note: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  saveWrap: { borderRadius: 16, overflow: 'hidden' },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
