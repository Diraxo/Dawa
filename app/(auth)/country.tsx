import { getClerkInstance } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Keyboard,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CareHubLogo } from '@/components/ui/CareHubLogo'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useTranslation } from 'react-i18next'

// ─── Data ────────────────────────────────────────────────────────────────────

interface Country {
  id: string
  name: string
}

const COUNTRIES: Country[] = [
  { id: 'AF', name: 'Afghanistan' },
  { id: 'DZ', name: 'Algeria' },
  { id: 'AO', name: 'Angola' },
  { id: 'BF', name: 'Burkina Faso' },
  { id: 'BI', name: 'Burundi' },
  { id: 'CM', name: 'Cameroon' },
  { id: 'TD', name: 'Chad' },
  { id: 'KM', name: 'Comoros' },
  { id: 'CD', name: 'Congo (DRC)' },
  { id: 'DJ', name: 'Djibouti' },
  { id: 'EG', name: 'Egypt' },
  { id: 'ER', name: 'Eritrea' },
  { id: 'ET', name: 'Ethiopia' },
  { id: 'GH', name: 'Ghana' },
  { id: 'GN', name: 'Guinea' },
  { id: 'CI', name: 'Ivory Coast' },
  { id: 'KE', name: 'Kenya' },
  { id: 'LR', name: 'Liberia' },
  { id: 'LY', name: 'Libya' },
  { id: 'MG', name: 'Madagascar' },
  { id: 'MW', name: 'Malawi' },
  { id: 'ML', name: 'Mali' },
  { id: 'MR', name: 'Mauritania' },
  { id: 'MA', name: 'Morocco' },
  { id: 'MZ', name: 'Mozambique' },
  { id: 'NA', name: 'Namibia' },
  { id: 'NE', name: 'Niger' },
  { id: 'NG', name: 'Nigeria' },
  { id: 'RW', name: 'Rwanda' },
  { id: 'SA', name: 'Saudi Arabia' },
  { id: 'SN', name: 'Senegal' },
  { id: 'SL', name: 'Sierra Leone' },
  { id: 'SO', name: 'Somalia' },
  { id: 'ZA', name: 'South Africa' },
  { id: 'SS', name: 'South Sudan' },
  { id: 'SD', name: 'Sudan' },
  { id: 'TZ', name: 'Tanzania' },
  { id: 'TN', name: 'Tunisia' },
  { id: 'UG', name: 'Uganda' },
  { id: 'AE', name: 'United Arab Emirates' },
  { id: 'GB', name: 'United Kingdom' },
  { id: 'US', name: 'United States' },
  { id: 'YE', name: 'Yemen' },
  { id: 'ZM', name: 'Zambia' },
  { id: 'ZW', name: 'Zimbabwe' },
].sort((a, b) => a.name.localeCompare(b.name))

// Convert ISO country code → flag emoji
function getFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('')
}

// ─── Country Item ─────────────────────────────────────────────────────────────

interface CountryItemProps {
  item: Country
  selected: boolean
  isLast: boolean
  onPress: () => void
}

function CountryItem({ item, selected, isLast, onPress }: CountryItemProps) {
  const flag = getFlag(item.id)

  if (selected) {
    return (
      <Pressable onPress={onPress} style={styles.itemWrapper}>
        <LinearGradient
          colors={['#2962FF', '#00BFA5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.selectedItem}
        >
          <View style={styles.itemLeft}>
            <Text style={styles.flagText}>{flag}</Text>
            <Text style={styles.selectedItemText}>{item.name}</Text>
          </View>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={14} color={colors.tealGreen} />
          </View>
        </LinearGradient>
      </Pressable>
    )
  }

  return (
    <Pressable onPress={onPress} style={styles.itemWrapper}>
      <View style={styles.unselectedItem}>
        <View style={styles.itemLeft}>
          <Text style={styles.flagText}>{flag}</Text>
          <Text style={styles.itemText}>{item.name}</Text>
        </View>
      </View>
      {!isLast && <View style={styles.separator} />}
    </Pressable>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveCountryToSupabase(country: string) {
  try {
    const clerkId = getClerkInstance().user?.id
    if (!clerkId) return
    await supabase.from('users').update({ country }).eq('clerk_id', clerkId)
  } catch {
    // Not signed in yet — will persist after auth
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CountryScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { setSelectedCountry: persistCountry } = useAppStore()

  const searchRef = useRef<TextInput>(null)
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [enabledCodes, setEnabledCodes] = useState<string[] | null>(null)

  // Fetch enabled countries from admin settings
  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'countries')
      .maybeSingle()
      .then(({ data }) => {
        if (Array.isArray(data?.value)) setEnabledCodes(data.value as string[])
      })
  }, [])

  const visibleCountries = enabledCodes
    ? COUNTRIES.filter((c) => enabledCodes.includes(c.id))
    : COUNTRIES

  const filteredCountries = searchQuery.trim()
    ? visibleCountries.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : visibleCountries

  // Tap again to deselect
  const handleSelect = (name: string) => {
    Keyboard.dismiss()
    setSelectedCountry((prev) => (prev === name ? null : name))
  }

  const handleContinue = (dest?: string) => {
    Keyboard.dismiss()
    if (!selectedCountry) return
    persistCountry(selectedCountry)
    saveCountryToSupabase(selectedCountry)
    router.push((dest ?? '/(auth)/language') as never)
  }

  const isActive = selectedCountry !== null

  const renderItem = ({ item, index }: ListRenderItemInfo<Country>) => (
    <CountryItem
      item={item}
      selected={selectedCountry === item.name}
      isLast={index === filteredCountries.length - 1}
      onPress={() => handleSelect(item.name)}
    />
  )

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {/* ── GRADIENT HEADER with carved wave ── */}
      <LinearGradient
        colors={['#1A4598', '#00BFA5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: top + 10 }]}
      >
        <View style={styles.headerContent}>
          <CareHubLogo size={64} variant="dark" />
          <Text style={styles.brandName}>DAWA</Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>
        {/* Carved wave — white pill that overlaps from bottom */}
        <View style={styles.headerWave} />
      </LinearGradient>

      {/* ── TITLE + SUBTITLE ── */}
      <Pressable style={styles.titleSection} onPress={() => searchRef.current?.blur()}>
        <Text style={styles.title}>{t('pickCountry')}</Text>
        <Text style={styles.subtitle}>{t('pickCountrySubtitle')}</Text>
        {/* Search box */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#9CA3AF" />
          <TextInput
            ref={searchRef}
            style={styles.searchInput}
            placeholder={t('searchCountry')}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      </Pressable>

      {/* ── COUNTRY LIST ── */}
      <View style={styles.listContainer}>
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filteredCountries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={36} color={colors.steelGrey} />
              <Text style={styles.emptyText}>{t('noCountriesFound')} "{searchQuery}"</Text>
            </View>
          }
        />
        {/* Gradient fade indicates more content below */}
        <View style={[styles.scrollFade, { pointerEvents: 'none' }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>

      {/* ── FOOTER: Login + Sign Up buttons ── */}
      <View style={[styles.footer, { paddingBottom: Math.max(bottom, 20) }]}>
        {/* Login — outline */}
        <Pressable
          onPress={() => isActive && handleContinue('/(auth)/sign-in')}
          style={[styles.loginWrapper, !isActive && styles.disabledOpacity]}
          disabled={!isActive}
        >
          <View style={styles.loginButton}>
            <Text style={styles.loginText}>{t('login')}</Text>
          </View>
        </Pressable>

        {/* Sign Up — gradient */}
        <Pressable
          onPress={() => isActive && handleContinue('/(auth)/sign-up')}
          style={[styles.signUpWrapper, !isActive && styles.disabledOpacity]}
          disabled={!isActive}
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
  // White pill that carves into the gradient to create the wave
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
    paddingBottom: 8,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cloudGrey,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.steelGrey,
    paddingHorizontal: 12,
    height: 46,
    marginTop: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    padding: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.steelGrey,
    textAlign: 'center',
  },
  // ── List ──
  listContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#FFFFFF',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
  },
  itemWrapper: {
    // Vertical rhythm handled by item children
  },
  selectedItem: {
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
    marginVertical: 3,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  flagText: {
    fontSize: 22,
    lineHeight: 26,
  },
  selectedItemText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unselectedItem: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    justifyContent: 'space-between',
  },
  itemText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.inkBlack,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.steelGrey,
    marginHorizontal: 4,
    opacity: 0.8,
  },
  // Fade gradient to hint at more content
  scrollFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 56,
  },
  // ── Footer ──
  footer: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  disabledOpacity: {
    opacity: 0.5,
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
