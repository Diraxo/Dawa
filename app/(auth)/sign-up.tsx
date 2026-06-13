import { useAuth, useClerk, useSSO } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
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
import { supabaseEmailAuth } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'

WebBrowser.maybeCompleteAuthSession()

// ─── Languages ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { id: 'en', nativeName: 'English', englishName: 'English' },
  { id: 'so', nativeName: 'Soomaali', englishName: 'Somali' },
  { id: 'am', nativeName: 'አማርኛ', englishName: 'Amharic' },
  { id: 'om', nativeName: 'Afaan Oromoo', englishName: 'Oromo' },
  { id: 'ti', nativeName: 'ትግርኛ', englishName: 'Tigrinya' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
]

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SignUpScreen() {
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { isSignedIn } = useAuth()
  const { signOut } = useClerk()
  const { t } = useTranslation()
  const { selectedLanguage, setSelectedLanguage } = useAppStore()

  const [langDropdown, setLangDropdown] = useState(false)
  const currentLang =
    LANGUAGES.find((l) => l.id === (selectedLanguage ?? 'en')) ?? LANGUAGES[0]

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [globalError, setGlobalError] = useState('')
  const [signUpSuccess, setSignUpSuccess] = useState(false)

  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [facebookLoading, setFacebookLoading] = useState(false)

  const { startSSOFlow } = useSSO()

  const isFormReady =
    fullName.trim().length > 0 &&
    isValidEmail(email) &&
    password.length >= 8 &&
    password === confirmPassword

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    let ok = true
    setNameError('')
    setEmailError('')
    setPasswordError('')
    setConfirmError('')
    setGlobalError('')
    if (!fullName.trim()) { setNameError('Please enter your full name'); ok = false }
    if (!email.trim()) { setEmailError('Please enter your email address'); ok = false }
    else if (!isValidEmail(email)) { setEmailError('Please enter a valid email address'); ok = false }
    if (!password) { setPasswordError('Please enter a password'); ok = false }
    else if (password.length < 8) { setPasswordError('Password must be at least 8 characters'); ok = false }
    if (!confirmPassword) { setConfirmError('Please confirm your password'); ok = false }
    else if (password !== confirmPassword) { setConfirmError('Passwords must be the same'); ok = false }
    return ok
  }

  // ── Email sign-up via Supabase Auth ───────────────────────────────────────
  const handleContinue = async () => {
    if (!validate()) return
    setLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { data: { session }, error } = await supabaseEmailAuth.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { full_name: fullName.trim() } },
      })

      if (error) {
        const msg = error.message?.toLowerCase() ?? ''
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
          setEmailError('This email is already registered. Please sign in instead.')
        } else if (msg.includes('password')) {
          setPasswordError(error.message)
        } else {
          setGlobalError(error.message ?? 'Something went wrong. Please try again.')
        }
        return
      }

      if (session) {
        // Email confirmation disabled in Supabase — user is immediately active
        router.replace('/(auth)/role' as never)
      } else {
        // Email confirmation enabled — prompt user to check their inbox
        setSignUpSuccess(true)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Google SSO (Clerk) ────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    if (googleLoading) return
    if (isSignedIn) { try { await signOut() } catch {} }
    setGoogleLoading(true)
    setGlobalError('')
    try {
      const redirectUrl = Linking.createURL('/oauth-native-callback', { scheme: 'carehub' })
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_google', redirectUrl })
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId })
        router.replace('/(auth)/role' as never)
      } else if (setActive) {
        await setActive({})
        router.replace('/(auth)/role' as never)
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        router.replace('/(auth)/role' as never)
      } else if (code !== 'oauth_access_denied') {
        try { await signOut() } catch {}
        setGlobalError(err?.errors?.[0]?.message ?? 'Google sign-in failed. Please try again.')
      }
    } finally {
      setGoogleLoading(false)
    }
  }, [isSignedIn, googleLoading, signOut, startSSOFlow, router])

  // ── Facebook SSO (Clerk) ──────────────────────────────────────────────────
  const handleFacebook = useCallback(async () => {
    if (facebookLoading) return
    if (isSignedIn) { try { await signOut() } catch {} }
    setFacebookLoading(true)
    setGlobalError('')
    try {
      const redirectUrl = Linking.createURL('/oauth-native-callback', { scheme: 'carehub' })
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_facebook', redirectUrl })
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId })
        router.replace('/(auth)/role' as never)
      } else if (setActive) {
        await setActive({})
        router.replace('/(auth)/role' as never)
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'session_exists') {
        router.replace('/(auth)/role' as never)
      } else if (code !== 'oauth_access_denied') {
        try { await signOut() } catch {}
        setGlobalError(err?.errors?.[0]?.message ?? 'Facebook sign-in failed. Please try again.')
      }
    } finally {
      setFacebookLoading(false)
    }
  }, [isSignedIn, facebookLoading, signOut, startSSOFlow, router])

  // ── Success state (email confirmation required) ────────────────────────────
  if (signUpSuccess) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <StatusBar style="dark" />
        <View style={[styles.successContainer, { paddingTop: top + 32, paddingBottom: Math.max(bottom, 32) }]}>
          <Ionicons name="mail-open-outline" size={72} color={colors.tealGreen} />
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successBody}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
          </Text>
          <Text style={styles.successHint}>
            Click the link in the email to activate your account, then come back to sign in.
          </Text>
          <Pressable onPress={() => router.push('/(auth)/sign-in' as never)} style={styles.goSignIn}>
            <LinearGradient
              colors={['#2962FF', '#00BFA5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.goSignInGradient}
            >
              <Text style={styles.goSignInText}>Go to Sign In</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
          <CareHubLogo size={72} />
          <Text style={styles.brandName}>CARE<Text style={styles.brandHub}>HUB</Text></Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>

        {/* ── TITLE ── */}
        <Text style={styles.title}>{t('createAccount')}</Text>
        <Text style={styles.subtitle}>{t('createAccountSubtitle')}</Text>

        {/* ── FORM ── */}
        <View style={styles.form}>
          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!nameError && styles.inputRowError]}>
              <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                style={styles.input}
                placeholder="Full name"
                placeholderTextColor="#9CA3AF"
                value={fullName}
                onChangeText={(v) => { setFullName(v); setNameError('') }}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            {!!nameError && <Text style={styles.fieldError}>{nameError}</Text>}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <View style={[styles.inputRow, !!emailError && styles.inputRowError]}>
              <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.icon} />
              <TextInput
                style={styles.input}
                placeholder={t('typeEmail')}
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={(v) => { setEmail(v); setEmailError('') }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
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
                style={[styles.input, styles.inputFlex]}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                value={password}
                onChangeText={(v) => { setPassword(v); setPasswordError('') }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8} style={styles.eyeBtn}>
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
                style={[styles.input, styles.inputFlex]}
                placeholder="Confirm password"
                placeholderTextColor="#9CA3AF"
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); setConfirmError('') }}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
              <Pressable onPress={() => setShowConfirm((p) => !p)} hitSlop={8} style={styles.eyeBtn}>
                <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
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
          style={[styles.googleBtn, googleLoading && styles.dimmed]}
        >
          {googleLoading
            ? <ActivityIndicator size="small" color="#757575" />
            : <Image source={require('@/assets/Google.svg')} style={styles.socialIcon} contentFit="contain" />
          }
          <Text style={styles.googleText}>{t('continueWithGoogle')}</Text>
        </Pressable>

        {/* ── FACEBOOK ── */}
        <Pressable
          onPress={handleFacebook}
          disabled={facebookLoading}
          style={[styles.facebookBtn, facebookLoading && styles.dimmed]}
        >
          {facebookLoading
            ? <ActivityIndicator size="small" color="#757575" />
            : <Image source={require('@/assets/fb.svg.png')} style={styles.socialIcon} contentFit="contain" />
          }
          <Text style={styles.facebookText}>{t('continueWithFacebook')}</Text>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },

  // Success screen
  successContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16,
    backgroundColor: '#FFFFFF',
  },
  successTitle: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, textAlign: 'center' },
  successBody: { fontFamily: fonts.regular, fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
  successEmail: { fontFamily: fonts.bold, color: colors.inkBlack },
  successHint: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  goSignIn: { borderRadius: 16, overflow: 'hidden', width: '100%', marginTop: 8 },
  goSignInGradient: { height: 52, alignItems: 'center', justifyContent: 'center' },
  goSignInText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },

  topNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  backBtn: { padding: 4 },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4, paddingHorizontal: 2 },
  langText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  modalOverlay: { flex: 1 },
  langMenu: {
    position: 'absolute', right: 24, backgroundColor: '#FFFFFF', borderRadius: 12,
    paddingVertical: 6, minWidth: 180, elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12,
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
  inputFlex: { flex: 1 },
  eyeBtn: { paddingLeft: 8, paddingVertical: 2 },
  fieldError: { fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginTop: 5, marginLeft: 2, lineHeight: 16 },
  globalError: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, textAlign: 'center', marginBottom: 14, lineHeight: 18 },

  continueWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  continueBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  continueText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  dimmed: { opacity: 0.5 },

  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.steelGrey },
  orText: { fontFamily: fonts.medium, fontSize: 13, color: '#9CA3AF' },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: '#DADCE0', backgroundColor: '#FFFFFF', gap: 10,
  },
  googleText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#3C4043' },

  facebookBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: '#DADCE0', backgroundColor: '#FFFFFF', gap: 10, marginTop: 12,
  },
  facebookText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#3C4043' },
  socialIcon: { width: 24, height: 24 },

  loginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28, paddingBottom: 8 },
  loginText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  loginLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },
})
