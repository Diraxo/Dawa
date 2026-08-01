import { useAuth, useSignIn, useSSO } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import * as Linking from 'expo-linking'
import { useFocusEffect, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DawaLogo } from '@/components/ui/DawaLogo'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { LANGUAGES } from '@/constants/languages'
import { loginLimiter } from '@/lib/loginLimiter'
import { markOAuthInFlight } from '@/lib/oauthResume'
import { resolveAuthDestination } from '@/lib/resolveAuthDestination'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

WebBrowser.maybeCompleteAuthSession()

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default function SignInScreen() {
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { isSignedIn, userId, getToken } = useAuth()
  const { t } = useTranslation()
  const { selectedLanguage, setSelectedLanguage } = useAppStore()
  const { isLoaded, signIn, setActive } = useSignIn()
  const { startSSOFlow } = useSSO()

  const { userRole: localRole, setUserRole } = useAuthStore()

  const [langDropdown, setLangDropdown] = useState(false)
  const currentLang =
    LANGUAGES.find((l) => l.id === (selectedLanguage ?? 'en')) ?? LANGUAGES[0]

  const [inputKey, setInputKey] = useState(0)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)

  const isFormReady = isValidEmail(email) && password.length > 0

  // ── Shared redirect state ─────────────────────────────────────────────────
  const redirectingRef = useRef(false)
  const intendingSignInRef = useRef(false)
  // Refs (not just the loading state) guard re-entrancy: state updates are
  // batched, so two taps fired in the same tick both see the old
  // `loading === false` and would otherwise both fire the request.
  const submittingRef = useRef(false)
  const googleSubmittingRef = useRef(false)
  const appleSubmittingRef = useRef(false)

  // Uses getToken() directly so the Supabase query works immediately after setActive,
  // before _layout.tsx's _clerkTokenGetter effect fires.
  const checkRoleAndRedirect = useCallback(async (clerkId: string) => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    try {
      const token = await getToken()
      const client = token ? getAuthClient(token) : supabase
      const dest = await resolveAuthDestination(client, clerkId)
      if (dest.role) setUserRole(dest.role)
      router.replace(dest.route as never)
    } catch {
      if (localRole === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
      else if (localRole === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      else router.replace('/(auth)/role' as never)
    } finally {
      redirectingRef.current = false
    }
  }, [router, localRole, getToken, setUserRole])

  // Clear form every time this screen comes into focus (prevents OS autofill persistence)
  useFocusEffect(
    useCallback(() => {
      setInputKey(k => k + 1)
      setEmail('')
      setPassword('')
      setEmailError('')
      setPasswordError('')
      setGlobalError('')
      setShowPassword(false)
    }, [])
  )

  // ── Redirect to dashboard if user is already authenticated ──────────────────
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn && userId && !intendingSignInRef.current) {
        checkRoleAndRedirect(userId)
      }
    }, [isSignedIn, userId, checkRoleAndRedirect])
  )

  // ── Fires whenever Clerk establishes a session — covers all paths: ────────────
  // email sign-in, SSO setActive, and Android edge cases where startSSOFlow
  // returns null but Clerk still processes the session via the deep-link callback.
  // checkRoleAndRedirect's own redirectingRef prevents concurrent duplicate calls.
  useEffect(() => {
    if (!isSignedIn || !userId) return
    intendingSignInRef.current = false
    checkRoleAndRedirect(userId)
  }, [isSignedIn, userId, checkRoleAndRedirect])

  // ── Email + Password sign-in via Clerk ────────────────────────────────────
  const handleSignIn = async () => {
    if (!isLoaded || !isFormReady || submittingRef.current) return
    submittingRef.current = true
    const normalizedEmail = email.trim().toLowerCase()
    setEmailError('')
    setPasswordError('')
    setGlobalError('')
    setLoading(true)
    intendingSignInRef.current = true
    try {
      const limit = await loginLimiter.check(normalizedEmail)
      if (!limit.allowed) {
        setGlobalError(limit.message ?? 'Too many failed attempts. Please try again later.')
        intendingSignInRef.current = false
        return
      }

      const result = await signIn!.create({
        identifier: normalizedEmail,
        password,
      })
      if (result.status === 'complete' && result.createdSessionId) {
        await loginLimiter.recordSuccess(normalizedEmail)
        await setActive!({ session: result.createdSessionId })
        // The useEffect above handles redirect once isSignedIn/userId update from Clerk.
      } else {
        setGlobalError('Sign-in could not be completed. Please try again or use Google sign-in.')
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? ''
      // session_exists isn't a failed credential attempt — don't count it against the limiter.
      if (code !== 'session_exists') {
        await loginLimiter.recordFailure(normalizedEmail)
      }
      if (code === 'form_identifier_not_found') {
        setGlobalError('No account found with this email. Please sign up first.')
      } else if (code === 'form_password_incorrect') {
        setPasswordError('Incorrect password. If you signed up with Google, tap "Continue with Google" below.')
      } else if (code === 'too_many_requests') {
        setGlobalError('Too many failed attempts. Please try again later.')
      } else if (code === 'session_exists') {
        // Already signed in — redirect instead of showing an error
        if (userId) checkRoleAndRedirect(userId)
        else router.replace('/(auth)/role' as never)
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  // ── Google SSO (Clerk) ────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    if (googleSubmittingRef.current) return
    googleSubmittingRef.current = true
    setGoogleLoading(true)
    setGlobalError('')
    intendingSignInRef.current = true
    try {
      if (Platform.OS === 'web') {
        if (!signIn) return
        const redirectUrl = window.location.origin + '/oauth-native-callback'
        // oidcPrompt forces Google to always show the account picker
        await (signIn as any).create({ strategy: 'oauth_google', redirectUrl, oidcPrompt: 'select_account' })
        const authUrl = signIn.firstFactorVerification.externalVerificationRedirectURL
        if (authUrl) { window.location.href = authUrl.toString(); return }
        setGlobalError('Google sign-in failed. Please try again.')
      } else {
        // Marked right before handing off to Chrome — if Android kills this
        // process while it's foregrounded (routine on a release build with
        // no debugger attached; Expo Go/dev client are exempt from the
        // low-memory killer, which is why this never reproduces there) and
        // has to cold-relaunch us via the redirect deep link, app/index.tsx
        // reads this to skip replaying the full branded splash — see
        // lib/oauthResume.ts.
        await markOAuthInFlight()
        const redirectUrl = Linking.createURL('/oauth-native-callback')
        console.log('[Google SSO] starting flow, redirectUrl:', redirectUrl)
        const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({ strategy: 'oauth_google', redirectUrl })
        console.log('[Google SSO] startSSOFlow resolved, createdSessionId:', createdSessionId ?? null)
        if (createdSessionId && ssoSetActive) {
          await ssoSetActive({ session: createdSessionId })
        } else {
          intendingSignInRef.current = false
        }
      }
    } catch (err: any) {
      console.error('[Google SSO] error:', JSON.stringify(err, null, 2), err?.message, err?.errors)
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        if (userId) checkRoleAndRedirect(userId)
        else setGlobalError('Session error. Please try again.')
      } else if (code !== 'oauth_access_denied') {
        intendingSignInRef.current = false
        const msg = err?.errors?.[0]?.message ?? err?.message ?? 'Google sign-in failed. Please try again.'
        setGlobalError(msg)
      } else {
        intendingSignInRef.current = false
      }
    } finally {
      googleSubmittingRef.current = false
      setGoogleLoading(false)
    }
  }, [startSSOFlow, signIn, router, userId, checkRoleAndRedirect])

  // ── Apple SSO (Clerk) ─────────────────────────────────────────────────────
  const handleApple = useCallback(async () => {
    if (appleSubmittingRef.current) return
    appleSubmittingRef.current = true
    setAppleLoading(true)
    setGlobalError('')
    intendingSignInRef.current = true
    try {
      if (Platform.OS === 'web') {
        if (!signIn) return
        const redirectUrl = window.location.origin + '/oauth-native-callback'
        await signIn.create({ strategy: 'oauth_apple', redirectUrl })
        const authUrl = signIn.firstFactorVerification.externalVerificationRedirectURL
        if (authUrl) { window.location.href = authUrl.toString(); return }
        setGlobalError('Apple sign-in failed. Please try again.')
      } else {
        // See the matching comment in handleGoogle above.
        await markOAuthInFlight()
        const redirectUrl = Linking.createURL('/oauth-native-callback')
        console.log('[Apple SSO] starting flow, redirectUrl:', redirectUrl)
        const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({ strategy: 'oauth_apple', redirectUrl })
        console.log('[Apple SSO] startSSOFlow resolved, createdSessionId:', createdSessionId ?? null)
        if (createdSessionId && ssoSetActive) {
          await ssoSetActive({ session: createdSessionId })
        } else {
          intendingSignInRef.current = false
        }
      }
    } catch (err: any) {
      console.error('[Apple SSO] error:', JSON.stringify(err, null, 2), err?.message, err?.errors)
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        if (userId) checkRoleAndRedirect(userId)
        else setGlobalError('Session error. Please try again.')
      } else if (code !== 'oauth_access_denied') {
        intendingSignInRef.current = false
        const msg = err?.errors?.[0]?.message ?? err?.message ?? 'Apple sign-in failed. Please try again.'
        setGlobalError(msg)
      } else {
        intendingSignInRef.current = false
      }
    } finally {
      appleSubmittingRef.current = false
      setAppleLoading(false)
    }
  }, [signIn, startSSOFlow, router, userId, checkRoleAndRedirect])

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />

      <Modal
        visible={langDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setLangDropdown(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setLangDropdown(false)}>
          <View style={[styles.langMenu, { top: top + 48 }]}>
            {LANGUAGES.map((lang) => {
              const isSelected = (selectedLanguage ?? 'en') === lang.id
              return (
                <Pressable
                  key={lang.id}
                  style={[styles.langMenuItem, isSelected && styles.langMenuItemActive]}
                  onPress={() => { setSelectedLanguage(lang.id); setLangDropdown(false) }}
                >
                  <Text style={[styles.langMenuItemText, isSelected && styles.langMenuItemTextActive]}>
                    {lang.nativeName}
                  </Text>
                  {lang.nativeName !== lang.englishName && (
                    <Text style={styles.langMenuItemSub}>{lang.englishName}</Text>
                  )}
                  {isSelected && (
                    <Ionicons name="checkmark" size={16} color={colors.tealGreen} style={styles.langMenuCheck} />
                  )}
                </Pressable>
              )
            })}
          </View>
        </Pressable>
      </Modal>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: top + 4, paddingBottom: Math.max(bottom, 28) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── TOP NAV ── */}
        <View style={styles.topNav}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/language' as never)}
            hitSlop={8}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.inkBlack} />
          </Pressable>
          <Pressable style={styles.langBtn} onPress={() => setLangDropdown(true)}>
            <Text style={styles.langText}>{currentLang.nativeName}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.inkBlack} />
          </Pressable>
        </View>

        {/* ── LOGO ── */}
        <View style={styles.logoRow}>
          <DawaLogo size={56} variant="dark" />
          <Text style={styles.brandName}>DA<Text style={styles.brandHub}>WA</Text></Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>

        {/* ── TITLE ── */}
        <Text style={styles.title}>{t('welcomeBack')}</Text>
        <Text style={styles.subtitle}>{t('signInSubtitle')}</Text>

        {/* ── FORM ── */}
        <View style={styles.form}>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!emailError && styles.inputRowError]}>
              <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                key={`email-${inputKey}`}
                style={styles.input}
                placeholder={t('typeEmail')}
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={(v) => { setEmail(v.toLowerCase()); setEmailError('') }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                returnKeyType="next"
              />
            </View>
            {!!emailError && <Text style={styles.fieldError}>{emailError}</Text>}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!passwordError && styles.inputRowError]}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                key={`password-${inputKey}`}
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                value={password}
                onChangeText={(v) => { setPassword(v); setPasswordError('') }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
              <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
              </Pressable>
            </View>
            {!!passwordError && <Text style={styles.fieldError}>{passwordError}</Text>}
          </View>

          {/* Forgot password */}
          <View style={styles.forgotRow}>
            <Pressable onPress={() => router.push('/(auth)/forgot-password' as never)} hitSlop={8}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </Pressable>
          </View>

          {!!globalError && <Text style={styles.globalError}>{globalError}</Text>}

          <Pressable
            onPress={handleSignIn}
            disabled={!isFormReady || loading}
            style={[styles.signInWrapper, (!isFormReady || loading) && styles.dimmed]}
          >
            <LinearGradient
              colors={['#2962FF', '#00BFA5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.signInBtn}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.signInText}>{t('signIn')}</Text>
              }
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── OR DIVIDER ── */}
        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>{t('orDivider')}</Text>
          <View style={styles.orLine} />
        </View>

        {/* ── APPLE (iOS only, per App Store Guideline 4.8) ── */}
        {Platform.OS === 'ios' && (
          <Pressable
            onPress={handleApple}
            disabled={appleLoading}
            style={[styles.socialBtn, styles.appleBtn, appleLoading && styles.dimmed]}
          >
            {appleLoading
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
            }
            <Text style={[styles.socialBtnText, styles.appleBtnText]}>Continue with Apple</Text>
          </Pressable>
        )}

        {/* ── GOOGLE ── */}
        <Pressable
          onPress={handleGoogle}
          disabled={googleLoading}
          style={[styles.socialBtn, Platform.OS === 'ios' && styles.socialBtnMarginTop, googleLoading && styles.dimmed]}
        >
          {googleLoading
            ? <ActivityIndicator size="small" color={colors.inkBlack} />
            : <Image source={require('@/assets/Google.svg')} style={styles.socialIcon} contentFit="contain" />
          }
          <Text style={styles.socialBtnText}>{t('continueWithGoogle')}</Text>
        </Pressable>

        {/* ── SIGN UP LINK ── */}
        <View style={styles.signUpRow}>
          <Text style={styles.signUpText}>{t('noAccount')} </Text>
          <Pressable onPress={() => router.push('/(auth)/sign-up' as never)}>
            <Text style={styles.signUpLink}>{t('signUpFree')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },

  topNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  backBtn: { padding: 4 },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4, paddingHorizontal: 2 },
  langText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  modalOverlay: { flex: 1 },
  langMenu: {
    position: 'absolute', right: 24, backgroundColor: '#FFFFFF', borderRadius: 12,
    paddingVertical: 6, minWidth: 180,
    ...shadow('#000', 0, 4, 12, 0.15, 8),
    borderWidth: 1, borderColor: colors.steelGrey,
  },
  langMenuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  langMenuItemActive: { backgroundColor: '#F0F7FF' },
  langMenuItemText: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkBlack, flex: 1 },
  langMenuItemTextActive: { color: colors.interactiveBlue, fontFamily: fonts.semiBold },
  langMenuItemSub: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginLeft: 6 },
  langMenuCheck: { marginLeft: 8 },

  logoRow: { alignItems: 'center', marginTop: 16, marginBottom: 24 },
  brandName: { fontFamily: fonts.bold, fontSize: 30, color: colors.inkBlack, letterSpacing: 1.5, lineHeight: 36, marginTop: 8 },
  brandHub: { color: colors.tealGreen },
  tagline: { fontFamily: fonts.medium, fontSize: 10, color: '#9CA3AF', letterSpacing: 1, marginTop: 2 },

  title: { fontFamily: fonts.bold, fontSize: 32, color: colors.inkBlack, lineHeight: 38, textAlign: 'center' },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', marginTop: 6, marginBottom: 28, lineHeight: 22, textAlign: 'center' },

  form: { marginBottom: 4 },
  fieldGroup: { marginBottom: 22 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.5, borderBottomColor: colors.steelGrey, paddingBottom: 10 },
  inputRowError: { borderBottomColor: colors.error },
  icon: { marginRight: 10 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack, height: 28, paddingVertical: 0 },
  fieldError: { fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginTop: 5, marginLeft: 2, lineHeight: 16 },
  globalError: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, textAlign: 'center', marginBottom: 14, lineHeight: 18 },

  forgotRow: { alignItems: 'flex-end', marginTop: -10, marginBottom: 20 },
  forgotLink: { fontFamily: fonts.medium, fontSize: 13, color: colors.interactiveBlue },

  signInWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  signInBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  signInText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  dimmed: { opacity: 0.5 },

  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.steelGrey },
  orText: { fontFamily: fonts.medium, fontSize: 13, color: '#9CA3AF' },

  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.steelGrey, backgroundColor: '#FFFFFF', gap: 10,
  },
  socialBtnMarginTop: { marginTop: 12 },
  socialBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  socialIcon: { width: 24, height: 24 },
  appleBtn: { backgroundColor: '#000000', borderColor: '#000000' },
  appleBtnText: { color: '#FFFFFF' },

  signUpRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28, paddingBottom: 8 },
  signUpText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  signUpLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },
})
