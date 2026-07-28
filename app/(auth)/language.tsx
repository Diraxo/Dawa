import { getClerkInstance } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DawaLogo } from '@/components/ui/DawaLogo'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useAuthenticatedRedirect } from '@/hooks/useAuthenticatedRedirect'
import i18n from '@/lib/i18n'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'

// ─── Data ─────────────────────────────────────────────────────────────────────

interface Language {
  id: string
  nativeName: string
  englishName: string
}

// Order: English, Somali, Amharic, Afaan Oromoo, Tigrinya, Arabic
const LANGUAGES: Language[] = [
  { id: 'en', nativeName: 'English', englishName: 'English' },
  { id: 'so', nativeName: 'Soomaali', englishName: 'Somali' },
  { id: 'am', nativeName: 'አማርኛ', englishName: 'Amharic' },
  { id: 'om', nativeName: 'Afaan Oromoo', englishName: 'Oromo' },
  { id: 'ti', nativeName: 'ትግርኛ', englishName: 'Tigrinya' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveLanguageToSupabase(language: string) {
  try {
    const clerkId = getClerkInstance().user?.id
    if (!clerkId) return
    await supabase.from('users').update({ language }).eq('clerk_id', clerkId)
  } catch {
    // Not signed in yet — will persist after auth completes
  }
}

// ─── Language Item ─────────────────────────────────────────────────────────────

interface LanguageItemProps {
  item: Language
  selected: boolean
  isLast: boolean
  onPress: () => void
}

function LanguageItem({ item, selected, isLast, onPress }: LanguageItemProps) {
  if (selected) {
    return (
      <Pressable onPress={onPress}>
        <LinearGradient
          colors={['#2962FF', '#00BFA5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.selectedItem}
        >
          <View style={styles.selectedTextBlock}>
            <Text style={styles.selectedItemText}>{item.nativeName}</Text>
            {item.nativeName !== item.englishName && (
              <Text style={styles.selectedItemSub}>{item.englishName}</Text>
            )}
          </View>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={14} color={colors.tealGreen} />
          </View>
        </LinearGradient>
      </Pressable>
    )
  }

  return (
    <>
      <Pressable onPress={onPress} style={styles.unselectedItem}>
        <View style={styles.unselectedTextBlock}>
          <Text style={styles.itemText}>{item.nativeName}</Text>
          {item.nativeName !== item.englishName && (
            <Text style={styles.itemSubText}>{item.englishName}</Text>
          )}
        </View>
      </Pressable>
      {!isLast && <View style={styles.separator} />}
    </>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LanguageScreen() {
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { t } = useTranslation()
  const { setSelectedLanguage: persistLanguage } = useAppStore()

  useAuthenticatedRedirect()

  // English is the default — buttons start enabled
  const [selectedId, setSelectedId] = useState<string>('en')
  const [enabledLangCodes, setEnabledLangCodes] = useState<string[] | null>(null)

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'languages')
      .maybeSingle()
      .then(({ data }) => {
        if (Array.isArray(data?.value)) setEnabledLangCodes(data.value as string[])
      })
  }, [])

  const visibleLanguages = enabledLangCodes
    ? LANGUAGES.filter((l) => enabledLangCodes.includes(l.id))
    : LANGUAGES

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelect = (id: string) => {
    setSelectedId(id)
    i18n.changeLanguage(id)
  }

  const handleContinue = (dest: string) => {
    persistLanguage(selectedId)
    saveLanguageToSupabase(selectedId)
    router.push(dest as never)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = ({ item, index }: ListRenderItemInfo<Language>) => (
    <LanguageItem
      item={item}
      selected={selectedId === item.id}
      isLast={index === visibleLanguages.length - 1}
      onPress={() => handleSelect(item.id)}
    />
  )

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {/* ── GRADIENT HEADER ── */}
      <LinearGradient
        colors={['#1A4598', '#00BFA5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: top + 10 }]}
      >
        <View style={styles.headerContent}>
          <DawaLogo size={64} variant="dark" />
          <Text style={styles.brandName}>DAWA</Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>
        {/* White arc that carves into the gradient */}
        <View style={styles.headerWave} />
      </LinearGradient>

      {/* ── TITLE + SUBTITLE ── */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>{t('pickLanguage')}</Text>
        <Text style={styles.subtitle}>{t('pickLanguageSubtitle')}</Text>
      </View>

      {/* ── LANGUAGE LIST (card container, scrollable FlatList) ── */}
      <View style={styles.listCard}>
        <FlatList
          data={visibleLanguages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          bounces={false}
        />
      </View>

      {/* ── FOOTER: Login + Sign Up buttons ── */}
      <View style={[styles.footer, { paddingBottom: Math.max(bottom, 20) }]}>
        {/* Login — outline */}
        <Pressable
          onPress={() => handleContinue('/(auth)/sign-in')}
          style={styles.loginWrapper}
        >
          <View style={styles.loginButton}>
            <Text style={styles.loginText}>{t('login')}</Text>
          </View>
        </Pressable>

        {/* Sign Up — gradient */}
        <Pressable
          onPress={() => handleContinue('/(auth)/sign-up')}
          style={styles.signUpWrapper}
        >
          <LinearGradient
            colors={['#2962FF', '#00BFA5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.signUpButton}
          >
            <Text style={styles.signUpText}>{t('signUp')}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // ── Header ──
  header: {
    position: 'relative',
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  brandName: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: 2.5,
    marginTop: 8,
  },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  headerWave: {
    height: 32,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },

  // ── Title ──
  titleSection: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 30,
    color: colors.inkBlack,
    lineHeight: 36,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    marginTop: 6,
    lineHeight: 22,
  },

  // ── Language list card ──
  listCard: {
    flex: 1,
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    ...shadow('#000', 0, 2, 10, 0.08, 3),
    marginBottom: 4,
  },
  listContent: {
    paddingBottom: 4,
  },

  // ── Selected item ──
  selectedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 60,
  },
  selectedTextBlock: {
    flex: 1,
  },
  selectedItemText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  selectedItemSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  // ── Unselected item ──
  unselectedItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 56,
    justifyContent: 'center',
  },
  unselectedTextBlock: {},
  itemText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.inkBlack,
  },
  itemSubText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.steelGrey,
    marginHorizontal: 20,
  },

  // ── Footer ──
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 0,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 12,
  },
  loginWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  loginButton: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.inkBlack,
  },
  signUpWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  signUpButton: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signUpText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#FFFFFF',
  },
})
