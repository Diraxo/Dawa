import { useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { supabase, supabaseEmailAuth } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

// ─── Languages ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { id: 'en', nativeName: 'English', englishName: 'English' },
  { id: 'so', nativeName: 'Soomaali', englishName: 'Somali' },
  { id: 'am', nativeName: 'አማርኛ', englishName: 'Amharic' },
  { id: 'om', nativeName: 'Afaan Oromoo', englishName: 'Oromo' },
  { id: 'ti', nativeName: 'ትግርኛ', englishName: 'Tigrinya' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
]

type Role = 'patient' | 'doctor'

// ─── Illustration components ──────────────────────────────────────────────────

function PatientIllustration() {
  return (
    <View style={illustStyles.wrapper}>
      <View style={[illustStyles.circle, { backgroundColor: '#FFE8E4' }]}>
        <Ionicons name="people" size={80} color="#C0392B" />
      </View>
    </View>
  )
}

function DoctorIllustration() {
  return (
    <View style={illustStyles.wrapper}>
      <View style={[illustStyles.circle, { backgroundColor: '#D4F4F1' }]}>
        <Ionicons name="medical" size={72} color="#00796B" />
        <View style={illustStyles.badge}>
          <Ionicons name="pulse" size={14} color="#FFFFFF" />
        </View>
      </View>
    </View>
  )
}

const illustStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  circle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#00897B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
})

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RoleScreen() {
  const router = useRouter()
  const { top } = useSafeAreaInsets()
  const { user, isLoaded: userLoaded } = useUser()
  const { t } = useTranslation()
  const { selectedLanguage, setSelectedLanguage, selectedCountry } = useAppStore()
  const { setUserRole } = useAuthStore()

  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(false)
  const [langDropdown, setLangDropdown] = useState(false)

  const [supaUser, setSupaUser] = useState<any>(null)
  const [supaUserLoaded, setSupaUserLoaded] = useState(false)

  const currentLang =
    LANGUAGES.find((l) => l.id === (selectedLanguage ?? 'en')) ?? LANGUAGES[0]

  const patientScale = useRef(new Animated.Value(1)).current
  const doctorScale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    supabaseEmailAuth.auth.getSession().then(({ data: { session } }) => {
      setSupaUser(session?.user ?? null)
      setSupaUserLoaded(true)
    })
    const { data: { subscription } } = supabaseEmailAuth.auth.onAuthStateChange((_, session) => {
      setSupaUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userLoaded || !user?.id) return
    ;(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('clerk_id', user.id)
          .single()
        if (data?.role === 'patient') router.replace('/(patient)/(tabs)/home' as never)
        else if (data?.role === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
      } catch {}
    })()
  }, [userLoaded, user?.id])

  useEffect(() => {
    // Clerk user takes priority — don't let a stale Supabase email session redirect
    if (userLoaded && !!user) return
    if (!supaUserLoaded || !supaUser?.id) return
    ;(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('clerk_id', supaUser.id)
          .single()
        if (data?.role === 'patient') router.replace('/(patient)/(tabs)/home' as never)
        else if (data?.role === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
      } catch {}
    })()
  }, [supaUserLoaded, supaUser?.id, userLoaded, user])

  // ── Toggle + bounce animation ─────────────────────────────────────────────
  const bounce = (anim: Animated.Value, select: boolean) => {
    if (select) {
      Animated.sequence([
        Animated.spring(anim, { toValue: 1.09, useNativeDriver: true, tension: 400, friction: 4 }),
        Animated.spring(anim, { toValue: 1.05, useNativeDriver: true, tension: 150, friction: 8 }),
      ]).start()
    } else {
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 150, friction: 8 }).start()
    }
  }

  const handleSelect = (role: Role) => {
    const next = selectedRole === role ? null : role
    setSelectedRole(next)
    bounce(patientScale, next === 'patient')
    bounce(doctorScale, next === 'doctor')
  }

  // ── Continue ──────────────────────────────────────────────────────────────
  const handleContinue = async () => {
    const isClerkUser = userLoaded && !!user
    const isSupaUser = supaUserLoaded && !!supaUser
    if (!selectedRole || loading || (!isClerkUser && !isSupaUser)) return
    setLoading(true)
    try {
      const record = isClerkUser
        ? {
            clerk_id: user!.id,
            email: user!.primaryEmailAddress?.emailAddress ?? '',
            full_name: user!.fullName ?? '',
            role: selectedRole,
            country: selectedCountry ?? '',
            language: selectedLanguage ?? 'en',
          }
        : {
            clerk_id: supaUser!.id,
            email: supaUser!.email ?? '',
            full_name: (supaUser!.user_metadata?.full_name as string) ?? '',
            role: selectedRole,
            country: selectedCountry ?? '',
            language: selectedLanguage ?? 'en',
          }
      await supabase.from('users').upsert(record, { onConflict: 'clerk_id' })
      setUserRole(selectedRole)
      if (selectedRole === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      else router.replace('/(doctor)/registration/step-1' as never)
    } catch {
      setUserRole(selectedRole)
      if (selectedRole === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      else router.replace('/(doctor)/registration/step-1' as never)
    } finally {
      setLoading(false)
    }
  }

  // ── Card render helper ────────────────────────────────────────────────────
  const renderCard = (
    role: Role,
    label: string,
    Illustration: () => ReactElement,
    scale: Animated.Value,
  ) => {
    const isSelected = selectedRole === role
    const labelColor = role === 'doctor' ? colors.tealGreen : colors.inkBlack

    return (
      <Animated.View style={[styles.cardAnimWrapper, { transform: [{ scale }] }]}>
        <Pressable onPress={() => handleSelect(role)} style={styles.cardPressable}>
          {isSelected ? (
            <LinearGradient
              colors={['#2962FF', '#00BFA5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientBorder}
            >
              <View style={styles.cardInner}>
                <Illustration />
                <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
              </View>
            </LinearGradient>
          ) : (
            <View style={styles.cardUnselected}>
              <Illustration />
              <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
            </View>
          )}
        </Pressable>
      </Animated.View>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <LoadingOverlay
        visible={loading}
        message={
          selectedRole === 'patient'
            ? 'Setting up your patient profile...'
            : 'Setting up your doctor account...'
        }
      />
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />

        {/* ── LANGUAGE DROPDOWN MODAL ── */}
        <Modal
          visible={langDropdown}
          transparent
          animationType="fade"
          onRequestClose={() => setLangDropdown(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setLangDropdown(false)}>
            <View style={[styles.langMenu, { top: top + 48 }]}>
              {LANGUAGES.map((lang) => {
                const isActive = (selectedLanguage ?? 'en') === lang.id
                return (
                  <Pressable
                    key={lang.id}
                    style={[styles.langMenuItem, isActive && styles.langMenuItemActive]}
                    onPress={() => {
                      setSelectedLanguage(lang.id)
                      setLangDropdown(false)
                    }}
                  >
                    <Text style={[styles.langMenuItemText, isActive && styles.langMenuItemTextActive]}>
                      {lang.nativeName}
                    </Text>
                    {lang.nativeName !== lang.englishName && (
                      <Text style={styles.langMenuItemSub}>{lang.englishName}</Text>
                    )}
                    {isActive && (
                      <Ionicons name="checkmark" size={16} color={colors.tealGreen} style={styles.langMenuCheck} />
                    )}
                  </Pressable>
                )
              })}
            </View>
          </Pressable>
        </Modal>

        <View style={styles.container}>
          {/* ── TOP NAV ── */}
          <View style={styles.topNav}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.inkBlack} />
            </Pressable>
            <Pressable style={styles.langBtn} onPress={() => setLangDropdown(true)}>
              <Text style={styles.langText}>{currentLang.nativeName}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.inkBlack} />
            </Pressable>
          </View>

          {/* ── CONTENT ── */}
          <View style={styles.content}>
            <Text style={styles.title}>{t('whichOneAreYou')}</Text>
            <Text style={styles.subtitle}>{t('whichSubtitle')}</Text>

            {/* ── CARDS ── */}
            <View style={styles.cardsRow}>
              {renderCard('patient', t('patient'), PatientIllustration, patientScale)}
              {renderCard('doctor', t('healthcareProfessional'), DoctorIllustration, doctorScale)}
            </View>
          </View>

          {/* ── CONTINUE BUTTON ── */}
          <View style={styles.bottomSection}>
            <Pressable
              onPress={handleContinue}
              disabled={!selectedRole || loading || (!(userLoaded && user) && !(supaUserLoaded && supaUser))}
              style={styles.continuePressable}
            >
              {selectedRole ? (
                <LinearGradient
                  colors={['#2962FF', '#00BFA5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.continueBtn}
                >
                  <Text style={styles.continueText}>{t('continue')}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.continueBtn, styles.continueBtnDisabled]}>
                  <Text style={[styles.continueText, styles.continueTextDisabled]}>
                    {t('continue')}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cloudGrey,
  },
  container: {
    flex: 1,
    backgroundColor: colors.cloudGrey,
    paddingHorizontal: 24,
  },

  // ── Top Nav ──
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  backBtn: {
    padding: 4,
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  langText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.inkBlack,
  },

  // ── Language modal ──
  modalOverlay: {
    flex: 1,
  },
  langMenu: {
    position: 'absolute',
    right: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 180,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: colors.steelGrey,
  },
  langMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  langMenuItemActive: {
    backgroundColor: '#F0F7FF',
  },
  langMenuItemText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.inkBlack,
    flex: 1,
  },
  langMenuItemTextActive: {
    color: colors.interactiveBlue,
    fontFamily: fonts.semiBold,
  },
  langMenuItemSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    marginLeft: 6,
  },
  langMenuCheck: {
    marginLeft: 8,
  },

  // ── Content ──
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 16,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: colors.inkBlack,
    lineHeight: 38,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 40,
    paddingHorizontal: 16,
  },

  // ── Cards ──
  cardsRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  cardAnimWrapper: {
    flex: 1,
  },
  cardPressable: {
    flex: 1,
  },

  // ── Card: selected (gradient border wraps entire card) ──
  gradientBorder: {
    borderRadius: 20,
    padding: 3,
  },
  cardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 10,
    alignItems: 'center',
  },

  // ── Card: unselected ──
  cardUnselected: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 10,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },

  // ── Card label ──
  cardLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Bottom section ──
  bottomSection: {
    paddingBottom: 24,
    paddingTop: 16,
  },
  continuePressable: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  continueBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: colors.steelGrey,
  },
  continueText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  continueTextDisabled: {
    color: '#9CA3AF',
  },
})
