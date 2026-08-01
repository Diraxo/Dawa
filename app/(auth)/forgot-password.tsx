import { useSignIn } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DawaAlert } from '@/components/ui/DawaAlert'
import { DawaLogo } from '@/components/ui/DawaLogo'
import { OTPInput } from '@/components/ui/OTPInput'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useAuthDestination } from '@/hooks/useAuthDestination'
import { otpLimiter } from '@/lib/otpLimiter'
import { useTranslation } from 'react-i18next'

type Step = 'email' | 'otp' | 'password'

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
}

export default function ForgotPasswordScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { isLoaded, signIn, setActive } = useSignIn()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successAlert, setSuccessAlert] = useState(false)
  const [resendAlert, setResendAlert] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetRouteRef = useRef<string>('/(patient)/(tabs)/home')

  // Resolves the authenticated user's role (and, for doctors, approval
  // status) by Clerk id — never by email — and never falls back to Role
  // Selection just because the lookup temporarily failed.
  const { arm: armDestination, retry: retryDestination, error: destinationError } = useAuthDestination((dest) => {
    targetRouteRef.current = dest.route
    setLoading(false)
    setSuccessAlert(true)
    successTimerRef.current = setTimeout(() => {
      setSuccessAlert(false)
      router.replace(targetRouteRef.current as never)
    }, 2000)
  })

  useEffect(() => {
    if (destinationError) setLoading(false)
  }, [destinationError])

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  const otpComplete = otp.join('').length === 6

  // Step 1 – send reset code
  const handleSendCode = async () => {
    if (!isLoaded) return
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    const limit = await otpLimiter.canRequest(normalizedEmail)
    if (!limit.allowed) {
      setError(limit.message ?? 'Please wait before requesting another code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: normalizedEmail,
      })
      await otpLimiter.recordRequest(normalizedEmail)
      setStep('otp')
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code === 'form_identifier_not_found') {
        setError('No account found with this email address.')
      } else {
        setError(
          err?.errors?.[0]?.longMessage ??
            err?.errors?.[0]?.message ??
            'Failed to send reset code. Please try again.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  // Step 2 – verify OTP
  const handleVerifyOTP = async (codeOverride?: string) => {
    const code = codeOverride ?? otp.join('')
    if (!isLoaded || code.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
      })
      if (result.status === 'needs_new_password') {
        setStep('password')
      } else {
        setError('Verification failed. Please try again.')
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      if (code.includes('incorrect') || code.includes('code')) {
        setError('Incorrect code. Please check your email and try again.')
      } else {
        setError(
          err?.errors?.[0]?.longMessage ??
            err?.errors?.[0]?.message ??
            'Verification failed. Please try again.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  // Step 3 – set new password
  const handleResetPassword = async () => {
    if (!isLoaded) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await signIn.resetPassword({ password })
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId })
        // Role/status resolution + navigation is handled by useAuthDestination
        // below once Clerk's isSignedIn/userId reflect the new session.
        armDestination()
      } else {
        setError('Failed to reset password. Please try again.')
        setLoading(false)
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ''
      const message: string = err?.errors?.[0]?.message ?? ''
      if (code === 'resource_not_found' || message.toLowerCase().includes('no sign in was found')) {
        setError('This reset session has expired or is no longer valid. Please request a new reset code.')
      } else {
        setError(
          err?.errors?.[0]?.longMessage ??
            message ??
            'Failed to reset password. Please try again.'
        )
      }
      setLoading(false)
    }
  }

  const handleOTPChange = (newOtp: string[]) => {
    setOtp(newOtp)
    setError('')
    if (newOtp.every((d) => d !== '')) handleVerifyOTP(newOtp.join(''))
  }

  const handleResend = async () => {
    if (!isLoaded) return
    const normalizedEmail = email.trim().toLowerCase()
    const check = await otpLimiter.canRequest(normalizedEmail)
    if (!check.allowed) {
      setError(check.message ?? 'Please wait before requesting another code.')
      return
    }
    setOtp(['', '', '', '', '', ''])
    setError('')
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: normalizedEmail,
      })
      await otpLimiter.recordRequest(normalizedEmail)
      setResendAlert(true)
    } catch {
      setError('Failed to resend code. Please try again.')
    }
  }

  return (
    <>
      {/* ── Success alert: password reset ── */}
      <DawaAlert
        visible={successAlert}
        variant="success"
        title={t('passwordResetSuccess')}
        message={t('passwordResetMsg')}
        buttons={[
          {
            text: t('continue'),
            style: 'primary',
            onPress: () => {
              if (successTimerRef.current) clearTimeout(successTimerRef.current)
              setSuccessAlert(false)
              router.replace(targetRouteRef.current as never)
            },
          },
        ]}
      />

      {/* ── Info alert: code resent ── */}
      <DawaAlert
        visible={resendAlert}
        variant="info"
        title={t('codeResent')}
        message={t('codeResentMsg')}
        onClose={() => setResendAlert(false)}
        buttons={[
          {
            text: t('gotIt'),
            style: 'primary',
            onPress: () => setResendAlert(false),
          },
        ]}
      />

    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: top + 8, paddingBottom: Math.max(bottom, 28) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top nav */}
        <View style={styles.topNav}>
          <Pressable onPress={() => (step === 'email' ? (router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in' as never)) : setStep(step === 'otp' ? 'email' : 'otp'))} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.inkBlack} />
          </Pressable>
        </View>

        {/* Logo */}
        <View style={styles.logoRow}>
          <DawaLogo size={68} variant="dark" />
          <Text style={styles.brandName}>
            DA<Text style={styles.brandHub}>WA</Text>
          </Text>
        </View>

        {/* ── Step: Email ── */}
        {step === 'email' && (
          <>
            <Text style={styles.title}>{t('forgotPassword')}</Text>
            <Text style={styles.subtitle}>{t('forgotPasswordSubtitle')}</Text>

            <View style={styles.form}>
              <View style={[styles.inputRow, !!error && styles.inputRowError]}>
                <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('typeEmail')}
                  placeholderTextColor="#9CA3AF"
                  value={email}
                  onChangeText={(v) => { setEmail(v); setError('') }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSendCode}
                />
              </View>
              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                onPress={handleSendCode}
                disabled={loading}
                style={[styles.btnWrap, loading && styles.dimmed]}
              >
                <LinearGradient
                  colors={['#2962FF', '#00BFA5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.btn}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.btnText}>{t('sendResetCode')}</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}

        {/* ── Step: OTP ── */}
        {step === 'otp' && (
          <>
            <Text style={styles.title}>{t('checkYourEmail')}</Text>
            <Text style={styles.subtitle}>{t('weSentCodeTo')}</Text>
            <Text style={styles.emailBold}>{email}</Text>

            <View style={styles.form}>
              <OTPInput
                value={otp}
                onChange={handleOTPChange}
                hasError={!!error}
                autoFocus
              />
              {!!error && <Text style={[styles.errorText, styles.mt10]}>{error}</Text>}

              {/* Info card */}
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={18} color="#2962FF" />
                <Text style={styles.infoText}>{t('spamNote')}</Text>
              </View>

              <Pressable
                onPress={handleVerifyOTP}
                disabled={loading || !otpComplete}
                style={[styles.btnWrap, (loading || !otpComplete) && styles.dimmed]}
              >
                <LinearGradient
                  colors={['#2962FF', '#00BFA5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.btn}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.btnText}>{t('verifyCode')} →</Text>
                  )}
                </LinearGradient>
              </Pressable>

              <Pressable onPress={handleResend} style={styles.resendRow}>
                <Text style={styles.resendText}>{"Didn't receive the code? "}</Text>
                <Text style={styles.resendLink}>{t('resendCode')}</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ── Step: New Password ── */}
        {step === 'password' && (
          <>
            <Text style={styles.title}>{t('newPassword')}</Text>
            <Text style={styles.subtitle}>Enter and confirm your new password.</Text>

            <View style={styles.form}>
              {/* New password */}
              <View style={styles.fieldGroup}>
                <View style={[styles.inputRow, styles.inputRowWithToggle]}>
                  <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    placeholder={t('newPassword')}
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={(v) => { setPassword(v); setError('') }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    returnKeyType="next"
                  />
                  <Pressable onPress={() => setShowPassword(p => !p)} hitSlop={12} style={styles.eyeBtn}>
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </Pressable>
                </View>
                <Text style={styles.hintText}>At least 8 characters</Text>
              </View>

              {/* Confirm password */}
              <View style={styles.fieldGroup}>
                <View style={[styles.inputRow, styles.inputRowWithToggle]}>
                  <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    placeholder={t('confirmPassword')}
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={(v) => { setConfirmPassword(v); setError('') }}
                    secureTextEntry={!showConfirm}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleResetPassword}
                  />
                  <Pressable onPress={() => setShowConfirm(p => !p)} hitSlop={12} style={styles.eyeBtn}>
                    <Ionicons
                      name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </Pressable>
                </View>
              </View>

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              {destinationError && (
                <View style={styles.verifyErrorBox}>
                  <Text style={styles.errorText}>
                    Your password was reset, but we couldn't verify your account. Please check your connection and try again.
                  </Text>
                  <Pressable onPress={retryDestination} style={styles.retryBtn} hitSlop={8}>
                    <Text style={styles.retryBtnText}>Try Again</Text>
                  </Pressable>
                </View>
              )}

              <Pressable
                onPress={handleResetPassword}
                disabled={loading}
                style={[styles.btnWrap, loading && styles.dimmed]}
              >
                <LinearGradient
                  colors={['#2962FF', '#00BFA5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.btn}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.btnText}>{t('resetPassword')}</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}

        {/* Back to Sign In */}
        <View style={styles.signInRow}>
          <Text style={styles.signInText}>Remember your password? </Text>
          <Pressable onPress={() => router.replace('/(auth)/sign-in' as never)}>
            <Text style={styles.signInLink}>Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },

  topNav: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },

  logoRow: { alignItems: 'center', marginTop: 12, marginBottom: 28 },
  brandName: {
    fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack,
    letterSpacing: 1.5, marginTop: 8,
  },
  brandHub: { color: colors.tealGreen },

  title: {
    fontFamily: fonts.bold, fontSize: 30, color: colors.inkBlack,
    lineHeight: 36, textAlign: 'center', marginBottom: 10,
  },
  subtitle: {
    fontFamily: fonts.regular, fontSize: 14, color: '#6B7280',
    lineHeight: 22, textAlign: 'center', marginBottom: 6,
  },
  emailBold: {
    fontFamily: fonts.bold, fontSize: 14, color: colors.inkBlack,
    textAlign: 'center', marginBottom: 28,
  },

  form: { marginTop: 8 },
  fieldGroup: { marginBottom: 22 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1.5, borderBottomColor: colors.steelGrey, paddingBottom: 10,
  },
  inputRowWithToggle: { borderBottomWidth: 1.5, borderBottomColor: colors.steelGrey },
  inputRowError: { borderBottomColor: colors.error },
  icon: { marginRight: 10 },
  input: {
    flex: 1, fontFamily: fonts.regular, fontSize: 15,
    color: colors.inkBlack, height: 28, paddingVertical: 0,
  },
  inputFlex: { flex: 1 },
  eyeBtn: { paddingLeft: 8, paddingVertical: 2 },
  hintText: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginTop: 5, marginLeft: 2 },

  errorText: {
    fontFamily: fonts.regular, fontSize: 12, color: colors.error,
    marginTop: 6, marginBottom: 4, lineHeight: 18,
  },
  mt10: { marginTop: 10 },

  verifyErrorBox: {
    backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, marginTop: 6, marginBottom: 4,
  },
  retryBtn: { marginTop: 10, alignSelf: 'flex-start' },
  retryBtnText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14,
    marginTop: 18, marginBottom: 20,
  },
  infoText: {
    flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#1E40AF', lineHeight: 20,
  },

  btnWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 6 },
  btn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  dimmed: { opacity: 0.5 },

  resendRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20,
  },
  resendText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  resendLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },

  signInRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 32,
  },
  signInText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  signInLink: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen },
})
