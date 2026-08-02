import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { images } from '@/constants/images'
import { LANGUAGES } from '@/constants/languages'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase, supabaseEmailAuth } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { useDoctorStore } from '@/store/doctorStore'


type Role = 'patient' | 'doctor'

// Clerk's Supabase JWT template tokens are short-lived (~60s). A token
// prefetched on mount can still be sitting in prefetchedTokenRef by the time
// the user taps Continue — decode its `exp` claim so we never hand PostgREST
// a token that's already dead (or about to die mid-flight), which it rejects
// as PGRST303 "JWT expired" rather than falling back to anon like a missing
// token would.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(base64))))
  } catch {
    return null
  }
}

function isJwtFreshEnough(token: string, bufferMs = 5000): boolean {
  const json = decodeJwtPayload(token)
  return !!json && typeof json.exp === 'number' && json.exp * 1000 - bufferMs > Date.now()
}

// ─── Illustration components ──────────────────────────────────────────────────

function PatientIllustration() {
  return (
    <View style={illustStyles.circleWrap}>
      <Image
        source={images.patientCard}
        style={illustStyles.circleImg}
        contentFit="cover"
      />
    </View>
  )
}

function DoctorIllustration() {
  return (
    <View style={illustStyles.circleWrap}>
      <Image
        source={images.doctorCard}
        style={illustStyles.circleImg}
        contentFit="cover"
      />
    </View>
  )
}

const illustStyles = StyleSheet.create({
  circleWrap: {
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: 'hidden',
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 14,
  },
  circleImg: {
    width: 140,
    height: 140,
  },
})

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RoleScreen() {
  const router = useRouter()
  const { top } = useSafeAreaInsets()
  const { user, isLoaded: userLoaded } = useUser()
  const { signOut, getToken } = useAuth()
  const { t } = useTranslation()
  const { selectedLanguage, setSelectedLanguage, selectedCountry } = useAppStore()
  const { setUserRole } = useAuthStore()
  const { clearReg } = useDoctorStore()

  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(false)
  const [langDropdown, setLangDropdown] = useState(false)

  const [supaUser, setSupaUser] = useState<any>(null)
  const [supaUserLoaded, setSupaUserLoaded] = useState(false)
  const [globalError, setGlobalError] = useState('')

  const currentLang =
    LANGUAGES.find((l) => l.id === (selectedLanguage ?? 'en')) ?? LANGUAGES[0]

  const patientScale = useRef(new Animated.Value(1)).current
  const doctorScale = useRef(new Animated.Value(1)).current
  // Ref (not just `loading` state) guards re-entrancy — state updates are
  // batched, so two taps fired in the same tick both still see the old
  // `loading === false` and would otherwise both upsert the profile row.
  const submittingRef = useRef(false)
  // Warms Clerk's token cache in the background from the moment this screen
  // mounts (right after sign-up/SSO), instead of only reaching for a token
  // when Continue is tapped. That gives the race described in handleContinue
  // the entire time the user spends looking at the two role cards to resolve
  // on its own — Google/Apple SSO users often land here and tap within a
  // second, which wasn't a wide enough window for the on-tap retry alone to
  // reliably cover on real devices.
  const prefetchedTokenRef = useRef<string | null>(null)

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
        // Must set the store's role before navigating — (patient)/_layout.tsx
        // and (doctor)/_layout.tsx guard on userRole matching their segment
        // and have no grace period for "signed in but role still null", so
        // landing on tabs without this bounces straight back out to sign-in
        // (which then resolves the role itself and sends the user back here
        // a second later — reads as the tab silently returning to Home).
        if (data?.role === 'patient') {
          setUserRole('patient')
          router.replace('/(patient)/(tabs)/home' as never)
        } else if (data?.role === 'doctor') {
          setUserRole('doctor')
          router.replace('/(doctor)/(tabs)/home' as never)
        }
      } catch {}
    })()
  }, [userLoaded, user?.id, setUserRole])

  useEffect(() => {
    if (!userLoaded || !user?.id) return
    let cancelled = false
    ;(async () => {
      for (const delay of [0, 400, 800, 1200, 1600]) {
        if (cancelled) return
        if (delay) await new Promise((r) => setTimeout(r, delay))
        try {
          const token = await getToken({ skipCache: true })
          if (token) {
            prefetchedTokenRef.current = token
            return
          }
        } catch {}
      }
      if (!cancelled) console.warn('[role] token prefetch never resolved after mount retries')
    })()
    return () => { cancelled = true }
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
        // See the matching comment in the Clerk-user effect above — the
        // store's role must be set before navigating into tabs, or the
        // layout guard bounces this straight back out.
        if (data?.role === 'patient') {
          setUserRole('patient')
          router.replace('/(patient)/(tabs)/home' as never)
        } else if (data?.role === 'doctor') {
          setUserRole('doctor')
          router.replace('/(doctor)/(tabs)/home' as never)
        }
      } catch {}
    })()
  }, [supaUserLoaded, supaUser?.id, userLoaded, user, setUserRole])

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

  // Reaching this screen always means the signed-in account has no completed
  // profile yet (the effects above redirect away as soon as one exists), so
  // "back" means abandoning onboarding. Signing out here — instead of just
  // navigating to sign-in while the Clerk session is still active — is what
  // stops sign-in/sign-up's own isSignedIn auto-redirect from immediately
  // bouncing the user straight back to this screen, trapping them.
  const handleBack = async () => {
    try {
      await signOut()
    } catch {}
    try {
      await supabaseEmailAuth.auth.signOut()
    } catch {}
    router.replace('/(auth)/sign-in' as never)
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
    if (!selectedRole || submittingRef.current || (!isClerkUser && !isSupaUser)) return
    submittingRef.current = true
    setLoading(true)
    setGlobalError('')
    try {
      // Reaching this screen typically means Clerk just finished a
      // sign-up/SSO flow moments ago — AppInitializer's effect that wires
      // Clerk's getToken() into the shared `supabase` client (lib/supabase.ts
      // _clerkTokenGetter) only runs after that state change re-renders, so
      // there's a window where the shared client's accessToken callback has
      // nothing to return and falls back to the (unrelated, unauthenticated)
      // Supabase-native session. That sends this upsert as `anon`, which the
      // users_insert_own RLS policy rejects with 42501. Fetching the token
      // directly here avoids depending on that effect having fired yet —
      // but plain getToken() also has its own race: right after setActive(),
      // Clerk's in-memory token cache can still return a stale `null` for a
      // brief window. A single fixed-delay retry wasn't a reliable enough
      // bound on that window (the 42501 kept recurring under real device
      // conditions even after that landed), so this polls skipCache with
      // short backoff for up to ~2.4s total before giving up.
      let client = supabase
      let usedToken: string | null = null
      if (isClerkUser) {
        let token: string | null =
          prefetchedTokenRef.current && isJwtFreshEnough(prefetchedTokenRef.current)
            ? prefetchedTokenRef.current
            : null
        if (!token) {
          for (const delay of [0, 300, 400, 500, 600, 600]) {
            if (delay) await new Promise((r) => setTimeout(r, delay))
            token = await getToken({ skipCache: true })
            if (token) break
          }
        }
        if (token) {
          usedToken = token
          client = getAuthClient(token)
        } else {
          console.warn('[role] no Clerk token available at submit time — upsert will go out unauthenticated and is expected to 42501')
        }
      }
      const record = isClerkUser
        ? {
            clerk_id: user!.id,
            email: user!.primaryEmailAddress?.emailAddress ?? '',
            full_name: user!.fullName ?? '',
            profile_photo_url: user!.imageUrl ?? null,
            role: selectedRole,
            country: selectedCountry ?? '',
            language: selectedLanguage ?? 'en',
          }
        : {
            clerk_id: supaUser!.id,
            email: supaUser!.email ?? '',
            full_name: (supaUser!.user_metadata?.full_name as string) ?? '',
            profile_photo_url: (supaUser!.user_metadata?.avatar_url as string) ?? null,
            role: selectedRole,
            country: selectedCountry ?? '',
            language: selectedLanguage ?? 'en',
          }
      const { error: upsertError } = await client.from('users').upsert(record, { onConflict: 'clerk_id' })
      if (upsertError) {
        // Don't blame "your connection" for a server-side rejection (RLS,
        // constraint violation, etc.) — log the real cause so it's
        // diagnosable, and only show the connection message when the error
        // actually looks like a network failure.
        console.error('[role] users upsert failed:', upsertError)
        if (upsertError.code === '42501') {
          // The two prior fixes (retry loop, then prefetch-on-mount) both
          // targeted "no token yet" — but that path logs its own warning
          // just above and this is a 42501 anyway, so a token was handed to
          // PostgREST. Log what was actually in it: if `sub` doesn't match
          // the row's clerk_id, or `role` isn't 'authenticated', the RLS
          // rejection is happening for a reason neither prior fix addresses.
          const claims = usedToken ? decodeJwtPayload(usedToken) : null
          console.error('[role] 42501 with token present — full decoded payload:', {
            hasToken: !!usedToken,
            expectedClerkId: user?.id,
            subMatchesClerkId: claims?.sub === user?.id,
            nowSec: Math.floor(Date.now() / 1000),
            claims,
          })
        }
        const msg = upsertError.message?.toLowerCase() ?? ''
        const isNetworkError = msg.includes('network') || msg.includes('fetch') || !upsertError.code
        // A stale `users` row from a previous account (deleted via Clerk
        // Dashboard, or a client-side delete that got interrupted before its
        // own anonymization update ran) can still hold this email under a
        // different clerk_id — onConflict: 'clerk_id' then tries an INSERT,
        // which collides with the separate users_email_key constraint. This
        // is a data-cleanup issue support needs to resolve, not something the
        // user can fix by retrying.
        const isEmailConflict = upsertError.code === '23505' && msg.includes('email')
        setGlobalError(
          isEmailConflict
            ? 'This email is already linked to a Dawa account that could not be fully removed. Please contact support at dawasupport@gmail.com to finish clearing it before signing up again.'
            : isNetworkError
              ? 'Failed to save your profile. Please check your connection and try again.'
              : `Something went wrong while saving your profile (${upsertError.code}). Please try again or contact support.`
        )
        return
      }
      setUserRole(selectedRole)
      if (selectedRole === 'patient') {
        router.replace('/(patient)/(tabs)/home' as never)
      } else {
        clearReg()
        router.replace('/(doctor)/registration/step-1' as never)
      }
    } catch (err) {
      console.error('[role] handleContinue threw:', err)
      setGlobalError('Something went wrong. Please try again.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
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
            <Pressable onPress={handleBack} hitSlop={8} style={styles.backBtn}>
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
              {/* Patient Card */}
              <Animated.View style={[styles.cardAnimWrapper, { transform: [{ scale: patientScale }] }]}>
                <Pressable onPress={() => handleSelect('patient')} style={styles.cardPressable}>
                  {selectedRole === 'patient' ? (
                    <LinearGradient
                      colors={['#2962FF', '#00BFA5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.gradientBorder}
                    >
                      <View style={styles.cardInner}>
                        <PatientIllustration />
                        <Text style={[styles.cardLabel, { color: colors.inkBlack }]}>Patient</Text>
                      </View>
                    </LinearGradient>
                  ) : (
                    <View style={styles.cardUnselected}>
                      <PatientIllustration />
                      <Text style={[styles.cardLabel, { color: colors.inkBlack }]}>Patient</Text>
                    </View>
                  )}
                </Pressable>
              </Animated.View>

              {/* Doctor Card */}
              <Animated.View style={[styles.cardAnimWrapper, { transform: [{ scale: doctorScale }] }]}>
                <Pressable onPress={() => handleSelect('doctor')} style={styles.cardPressable}>
                  {selectedRole === 'doctor' ? (
                    <LinearGradient
                      colors={['#2962FF', '#00BFA5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.gradientBorder}
                    >
                      <View style={styles.cardInner}>
                        <DoctorIllustration />
                        <Text style={[styles.cardLabel, { color: colors.tealGreen }]}>{t('healthcareProfessional')}</Text>
                      </View>
                    </LinearGradient>
                  ) : (
                    <View style={styles.cardUnselected}>
                      <DoctorIllustration />
                      <Text style={[styles.cardLabel, { color: colors.tealGreen }]}>Doctor</Text>
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            </View>
          </View>

          {/* ── CONTINUE BUTTON ── */}
          <View style={styles.bottomSection}>
            {!!globalError && (
              <Text style={styles.globalError}>{globalError}</Text>
            )}
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
    ...shadow('#000', 0, 4, 12, 0.15, 8),
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
    width: '100%',
  },

  // ── Card: selected — gradient wraps all 4 sides ──
  gradientBorder: {
    borderRadius: 20,
    padding: 3,
  },
  cardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    alignItems: 'center',
    paddingBottom: 18,
    overflow: 'hidden',
  },

  // ── Card: unselected ──
  cardUnselected: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    alignItems: 'center',
    paddingBottom: 18,
    ...shadow('#000', 0, 2, 8, 0.08, 4),
  },

  // ── Card label ──
  cardLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Bottom section ──
  bottomSection: {
    paddingBottom: 24,
    paddingTop: 16,
  },
  globalError: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 18,
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
