import { useAuth, useSignIn, useSignUp, useSSO } from '@clerk/clerk-expo'
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

import { CareHubLogo } from '@/components/ui/CareHubLogo'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { LANGUAGES } from '@/constants/languages'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

WebBrowser.maybeCompleteAuthSession()

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default function SignUpScreen() {
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { t } = useTranslation()
  const { selectedLanguage, setSelectedLanguage } = useAppStore()
  const { isLoaded, signUp } = useSignUp()
  const { signIn, isLoaded: signInLoaded, setActive } = useSignIn()
  const { startSSOFlow } = useSSO()
  const { isSignedIn, userId } = useAuth()

  const { userRole: localRole } = useAuthStore()

  const [langDropdown, setLangDropdown] = useState(false)
  const currentLang =
    LANGUAGES.find((l) => l.id === (selectedLanguage ?? 'en')) ?? LANGUAGES[0]

  const [inputKey, setInputKey] = useState(0)
  const [fullName, setFullName] = useState('')
  const [fullNameError, setFullNameError] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [facebookLoading, setFacebookLoading] = useState(false)

  const isFormReady = fullName.trim().length > 1 && isValidEmail(email) && password.length >= 8 && password === confirmPassword

  // ── Shared: check role and navigate to appropriate home ───────────────────
  const redirectingRef = useRef(false)
  const ssoInProgressRef = useRef(false)
  const checkRoleAndRedirect = useCallback(async (clerkId: string) => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    try {
      // Always query Supabase — if the row was deleted, send to role selection
      const { data } = await supabase.from('users').select('role').eq('clerk_id', clerkId).single()
      if (data?.role === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
      else if (data?.role === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      else router.replace('/(auth)/role' as never)
    } catch {
      // Supabase unreachable (network error) — fall back to cached role
      if (localRole === 'doctor') router.replace('/(doctor)/(tabs)/home' as never)
      else if (localRole === 'patient') router.replace('/(patient)/(tabs)/home' as never)
      else router.replace('/(auth)/role' as never)
    } finally {
      redirectingRef.current = false
    }
  }, [router, localRole])

  // Clear form every time this screen comes into focus (prevents OS autofill persistence)
  useFocusEffect(
    useCallback(() => {
      setInputKey(k => k + 1)
      setFullName('')
      setFullNameError('')
      setEmail('')
      setEmailError('')
      setPassword('')
      setPasswordError('')
      setConfirmPassword('')
      setConfirmError('')
      setGlobalError('')
      setShowPassword(false)
      setShowConfirmPassword(false)
    }, [])
  )

  // ── Redirect to dashboard if user is already authenticated ──────────────────
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn && userId && !ssoInProgressRef.current) {
        checkRoleAndRedirect(userId)
      }
    }, [isSignedIn, userId, checkRoleAndRedirect])
  )

  // ── Fire when Clerk auth state changes after SSO setActive ────────────────
  useEffect(() => {
    if (isSignedIn && userId && ssoInProgressRef.current) {
      ssoInProgressRef.current = false
      checkRoleAndRedirect(userId)
    }
  }, [isSignedIn, userId, checkRoleAndRedirect])

  // ── Email + Password sign-up via Clerk ────────────────────────────────────
  const handleContinue = async () => {
    if (!isLoaded || loading) return
    const normalizedEmail = email.trim().toLowerCase()
    let valid = true
    setFullNameError('')
    setEmailError('')
    setPasswordError('')
    setConfirmError('')
    setGlobalError('')

    if (!fullName.trim() || fullName.trim().length < 2) {
      setFullNameError('Please enter your full name.')
      valid = false
    }
    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Please enter a valid email address.')
      valid = false
    }
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      valid = false
    }
    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.')
      valid = false
    }
    if (!valid) return

    setLoading(true)
    try {
      const nameParts = fullName.trim().split(/\s+/)
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ') || undefined
      await signUp.create({ emailAddress: normalizedEmail, password, firstName, ...(lastName && { lastName }) })
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      router.push({
        pathname: '/(auth)/verify',
        params: { email: normalizedEmail, type: 'signup' },
      } as never)
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? ''
      if (code === 'form_identifier_exists') {
        setEmailError('An account with this email already exists. Please sign in instead.')
      } else if (code?.includes('password')) {
        setPasswordError(msg || 'Please choose a stronger password (min. 8 characters).')
      } else {
        setGlobalError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Google SSO (Clerk) ────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    if (googleLoading) return
    setGoogleLoading(true)
    setGlobalError('')
    ssoInProgressRef.current = true
    try {
      if (!signIn || !signInLoaded) return
      const redirectUrl = Linking.createURL('/oauth-native-callback')
      // Manually implement SSO flow so we can pass oidcPrompt: 'select_account'
      // to force Google to show the account picker instead of auto-selecting the last account
      await (signIn as any).create({ strategy: 'oauth_google', redirectUrl, oidcPrompt: 'select_account' })
      const { externalVerificationRedirectURL } = signIn.firstFactorVerification
      if (!externalVerificationRedirectURL) {
        ssoInProgressRef.current = false
        setGlobalError('Google sign-in failed. Please try again.')
        return
      }
      const authSessionResult = await WebBrowser.openAuthSessionAsync(
        externalVerificationRedirectURL.toString(),
        redirectUrl
      )
      if (authSessionResult.type !== 'success' || !authSessionResult.url) {
        ssoInProgressRef.current = false
        return
      }
      const urlParams = new URL(authSessionResult.url).searchParams
      const rotatingTokenNonce = urlParams.get('rotating_token_nonce') ?? ''
      await signIn.reload({ rotatingTokenNonce })
      const needsSignUp = signIn.firstFactorVerification.status === 'transferable'
      if (needsSignUp) {
        await signUp.create({ transfer: true })
        if (signUp.createdSessionId && setActive) {
          await setActive({ session: signUp.createdSessionId })
        }
      } else if (signIn.createdSessionId && setActive) {
        await setActive({ session: signIn.createdSessionId })
      }
    } catch (err: any) {
      ssoInProgressRef.current = false
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        if (userId) checkRoleAndRedirect(userId)
        else router.replace('/(auth)/role' as never)
      } else if (code !== 'oauth_access_denied') {
        setGlobalError(err?.errors?.[0]?.message ?? 'Google sign-in failed. Please try again.')
      }
    } finally {
      setGoogleLoading(false)
    }
  }, [googleLoading, signIn, signInLoaded, signUp, setActive, router, userId, checkRoleAndRedirect])

  // ── Facebook SSO (Clerk) ──────────────────────────────────────────────────
  const handleFacebook = useCallback(async () => {
    if (facebookLoading) return
    setFacebookLoading(true)
    setGlobalError('')
    ssoInProgressRef.current = true
    try {
      const redirectUrl = Linking.createURL('/oauth-native-callback')
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_facebook', redirectUrl })
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId })
        // useEffect above will fire once isSignedIn/userId updates
      }
    } catch (err: any) {
      ssoInProgressRef.current = false
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        if (userId) checkRoleAndRedirect(userId)
        else router.replace('/(auth)/role' as never)
      } else if (code !== 'oauth_access_denied') {
        setGlobalError(err?.errors?.[0]?.message ?? 'Facebook sign-in failed. Please try again.')
      }
    } finally {
      setFacebookLoading(false)
    }
  }, [facebookLoading, startSSOFlow, router, userId, checkRoleAndRedirect])

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
          <CareHubLogo size={56} variant="dark" />
          <Text style={styles.brandName}>DA<Text style={styles.brandHub}>WA</Text></Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>

        {/* ── TITLE ── */}
        <Text style={styles.title}>{t('createAccount')}</Text>
        <Text style={styles.subtitle}>{t('createAccountSubtitle')}</Text>

        {/* ── FORM ── */}
        <View style={styles.form}>

          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!fullNameError && styles.inputRowError]}>
              <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                key={`name-${inputKey}`}
                style={styles.input}
                placeholder={t('fullName')}
                placeholderTextColor="#9CA3AF"
                value={fullName}
                onChangeText={(v) => { setFullName(v); setFullNameError('') }}
                autoCapitalize="words"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                returnKeyType="next"
              />
            </View>
            {!!fullNameError && <Text style={styles.fieldError}>{fullNameError}</Text>}
          </View>

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
                onChangeText={(v) => { setEmail(v); setEmailError('') }}
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
                returnKeyType="next"
              />
              <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
              </Pressable>
            </View>
            {!!passwordError && <Text style={styles.fieldError}>{passwordError}</Text>}
          </View>

          {/* Confirm Password */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!confirmError && styles.inputRowError]}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                key={`confirm-${inputKey}`}
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor="#9CA3AF"
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); setConfirmError('') }}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
              <Pressable onPress={() => setShowConfirmPassword((p) => !p)} hitSlop={8}>
                <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
              </Pressable>
            </View>
            {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}
          </View>

          {!!globalError && <Text style={styles.globalError}>{globalError}</Text>}

          <Pressable
            onPress={handleContinue}
            disabled={!isFormReady || loading}
            style={[styles.continueWrapper, (!isFormReady || loading) && styles.dimmed]}
          >
            <LinearGradient
              colors={['#2962FF', '#00BFA5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.continueBtn}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.continueText}>{t('continue')}</Text>
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

        {/* ── GOOGLE ── */}
        <Pressable
          onPress={handleGoogle}
          disabled={googleLoading}
          style={[styles.socialBtn, googleLoading && styles.dimmed]}
        >
          {googleLoading
            ? <ActivityIndicator size="small" color={colors.inkBlack} />
            : <Image source={require('@/assets/Google.svg')} style={styles.socialIcon} contentFit="contain" />
          }
          <Text style={styles.socialBtnText}>{t('continueWithGoogle')}</Text>
        </Pressable>

        {/* ── FACEBOOK ── */}
        <Pressable
          onPress={handleFacebook}
          disabled={facebookLoading}
          style={[styles.socialBtn, styles.socialBtnMarginTop, facebookLoading && styles.dimmed]}
        >
          {facebookLoading
            ? <ActivityIndicator size="small" color={colors.inkBlack} />
            : <Image source={require('@/assets/fb.svg.png')} style={styles.socialIcon} contentFit="contain" />
          }
          <Text style={styles.socialBtnText}>{t('continueWithFacebook')}</Text>
        </Pressable>

        {/* ── LOGIN LINK ── */}
        <View style={styles.loginRow}>
          <Text style={styles.loginText}>{t('haveAccount')} </Text>
          <Pressable onPress={() => router.push('/(auth)/sign-in' as never)}>
            <Text style={styles.loginLink}>{t('login')}</Text>
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

  continueWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  continueBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  continueText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
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

  loginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28, paddingBottom: 8 },
  loginText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  loginLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },
})
