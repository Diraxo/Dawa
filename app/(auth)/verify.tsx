import { useSignIn, useSignUp } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { OTPInput } from '@/components/ui/OTPInput'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { otpLimiter } from '@/lib/otpLimiter'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/appStore'

const CODE_LENGTH = 6
const TIMER_SECONDS = 30

const LANG_NAMES: Record<string, string> = {
  en: 'English', so: 'Soomaali', am: 'አማርኛ', om: 'Afaan Oromoo', ti: 'ትግርኛ', ar: 'العربية',
}

export default function VerifyScreen() {
  const { t } = useTranslation()
  const { selectedLanguage } = useAppStore()
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { email, type } = useLocalSearchParams<{ email: string; type: string }>()
  const flowType = (type ?? 'signup') as 'signup' | 'forgot'

  const { isLoaded: suLoaded, signUp, setActive: suSetActive } = useSignUp()
  const { isLoaded: siLoaded, signIn } = useSignIn()

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [timer, setTimer] = useState(TIMER_SECONDS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (timer <= 0) return
    const id = setInterval(() => setTimer((t) => t - 1), 1000)
    return () => clearInterval(id)
  }, [timer])

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  // ── Verify OTP ────────────────────────────────────────────────────────────
  const verifyCode = async (codeStr: string) => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      if (flowType === 'signup' && suLoaded && signUp) {
        const result = await signUp.attemptEmailAddressVerification({ code: codeStr })
        if (result.status === 'complete' && result.createdSessionId) {
          await suSetActive!({ session: result.createdSessionId })
          router.replace('/(auth)/role' as never)
        } else {
          setError('Verification failed. Please try again.')
          setCode(Array(CODE_LENGTH).fill(''))
        }
      } else if (flowType === 'forgot' && siLoaded && signIn) {
        const result = await signIn.attemptFirstFactor({
          strategy: 'reset_password_email_code',
          code: codeStr,
        })
        if (result.status === 'needs_new_password') {
          router.replace({
            pathname: '/(auth)/reset-password',
            params: { email: email ?? '' },
          } as never)
        } else {
          setError('Verification failed. Please try again.')
          setCode(Array(CODE_LENGTH).fill(''))
        }
      }
    } catch (err: any) {
      const errCode: string = err?.errors?.[0]?.code ?? ''
      const errMsg: string =
        err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? 'Something went wrong.'
      const lower = errCode.toLowerCase() + errMsg.toLowerCase()
      setError(
        lower.includes('incorrect') || lower.includes('invalid') || lower.includes('wrong')
          ? 'Incorrect code. Please check and try again.'
          : lower.includes('expired')
          ? 'Code has expired. Tap "Resend code" below.'
          : errMsg
      )
      setCode(Array(CODE_LENGTH).fill(''))
    } finally {
      setLoading(false)
    }
  }

  const handleCodeChange = (newCode: string[]) => {
    setCode(newCode)
    setError('')
  }

  // Auto-submit as soon as all 6 digits are filled
  useEffect(() => {
    if (code.every((d) => d !== '') && !loading) {
      verifyCode(code.join(''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // ── Resend OTP ────────────────────────────────────────────────────────────
  const handleResend = async () => {
    setError('')
    const check = await otpLimiter.canRequest(email ?? '')
    if (!check.allowed) {
      if (check.waitSeconds) setTimer(check.waitSeconds)
      setError(check.message ?? 'Please wait before requesting another code.')
      return
    }
    try {
      if (flowType === 'signup' && suLoaded && signUp) {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      } else if (flowType === 'forgot' && siLoaded && signIn) {
        await signIn.create({ strategy: 'reset_password_email_code', identifier: email ?? '' })
      }
      await otpLimiter.recordRequest(email ?? '')
      setTimer(TIMER_SECONDS)
      setCode(Array(CODE_LENGTH).fill(''))
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Failed to resend. Please try again.')
    }
  }

  const isComplete = code.every((d) => d !== '')

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: top + 4, paddingBottom: Math.max(bottom, 32) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inner}>
          <View>
            {/* ── TOP NAV ── */}
            <View style={styles.topNav}>
              <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in' as never)} hitSlop={8} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color={colors.inkBlack} />
              </Pressable>
              <View style={styles.langBtn}>
                <Text style={styles.langText}>{LANG_NAMES[selectedLanguage ?? 'en'] ?? 'English'}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.inkBlack} />
              </View>
            </View>

            {/* ── HEADER ── */}
            <View style={styles.headerBlock}>
              <Text style={styles.title}>{t('verifyCode')}</Text>
              <Text style={styles.subtitle}>{t('verifySubtitle')}</Text>
              <Text style={styles.emailText}>{email}</Text>
            </View>

            {/* ── OTP BOXES ── */}
            <OTPInput value={code} onChange={handleCodeChange} hasError={!!error} />

            {/* ── TIMER / RESEND ── */}
            <View style={styles.timerRow}>
              {timer > 0 ? (
                <Text style={styles.timerText}>{t('resendCodeIn')} {fmt(timer)}</Text>
              ) : (
                <Pressable onPress={handleResend} hitSlop={8}>
                  <Text style={styles.resendLink}>{t('resendCode')}</Text>
                </Pressable>
              )}
            </View>

            {/* ── ERROR CARD ── */}
            {!!error && (
              <View style={styles.errorCard}>
                <Ionicons name="close-circle-outline" size={20} color={colors.error} style={styles.cardIcon} />
                <Text style={styles.errorCardText}>{error}</Text>
              </View>
            )}

            {/* ── INFO CARD ── */}
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={22} color={colors.interactiveBlue} style={styles.cardIcon} />
              <Text style={styles.infoText}>{t('spamNote')}</Text>
            </View>
          </View>

          {/* ── CONTINUE BUTTON ── */}
          <Pressable
            onPress={() => isComplete && !loading && verifyCode(code.join(''))}
            disabled={!isComplete || loading}
            style={[styles.continueWrapper, (!isComplete || loading) && styles.dimmed]}
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
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, backgroundColor: '#FFFFFF' },
  inner: { flex: 1, justifyContent: 'space-between' },

  topNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  backBtn: { padding: 4 },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  langText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  headerBlock: { alignItems: 'center', marginTop: 24, marginBottom: 36 },
  title: { fontFamily: fonts.bold, fontSize: 32, color: colors.inkBlack, lineHeight: 38, marginBottom: 12 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', lineHeight: 22 },
  emailText: { fontFamily: fonts.bold, fontSize: 14, color: colors.inkBlack, marginTop: 2 },

  timerRow: { alignItems: 'center', marginTop: 20, marginBottom: 24 },
  timerText: { fontFamily: fonts.regular, fontSize: 14, color: '#9CA3AF' },
  resendLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFF5F5',
    borderRadius: 12, padding: 14, marginBottom: 12, gap: 10,
  },
  errorCardText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.error, lineHeight: 20 },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#EFF6FF',
    borderRadius: 12, padding: 14, gap: 10,
  },
  cardIcon: { marginTop: 1 },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#374151', lineHeight: 20 },

  continueWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 32 },
  continueBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  continueText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  dimmed: { opacity: 0.5 },
})
