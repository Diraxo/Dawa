import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient } from '@/lib/supabase'

type EmailAddressResource = {
  id: string
  emailAddress: string
  prepareVerification: (params: { strategy: 'email_code' }) => Promise<unknown>
  attemptVerification: (params: { code: string }) => Promise<{ verification?: { status?: string } }>
  destroy: () => Promise<void>
}

function clerkErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { errors?: { message?: string; longMessage?: string }[] }
  return anyErr?.errors?.[0]?.longMessage ?? anyErr?.errors?.[0]?.message ?? fallback
}

/**
 * Two-step email-change flow shared by patient + doctor: create the new
 * address on the Clerk user, send a verification code, verify it, then
 * promote it to primary (Clerk requires the new address to be verified
 * before it can become primary/login email) and mirror it onto
 * `users.email` — the column every RLS policy and query joins keys off, so
 * skipping the sync would leave Clerk and Supabase disagreeing about the
 * account's email indefinitely.
 */
export function ChangeEmailModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean
  onClose: () => void
  onSuccess: (newEmail: string) => void
}) {
  const { user } = useUser()
  const { getToken } = useAuth()

  const [step, setStep] = useState<'input' | 'verify'>('input')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [pendingAddress, setPendingAddress] = useState<EmailAddressResource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setStep('input')
    setNewEmail('')
    setCode('')
    setPendingAddress(null)
    setError('')
    setLoading(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSendCode = async () => {
    if (!user) return
    const email = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const address = (await user.createEmailAddress({ email })) as unknown as EmailAddressResource
      await address.prepareVerification({ strategy: 'email_code' })
      setPendingAddress(address)
      setStep('verify')
    } catch (err) {
      setError(clerkErrorMessage(err, 'Could not send a verification code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!user || !pendingAddress) return
    if (code.trim().length < 4) {
      setError('Enter the code from your email.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await pendingAddress.attemptVerification({ code: code.trim() })
      if (result.verification?.status !== 'verified') {
        setError('That code is incorrect or has expired.')
        return
      }

      await user.update({ primaryEmailAddressId: pendingAddress.id })

      // Drop every other email address on the account so the new one is
      // unambiguously the login email, matching the "new email becomes the
      // login email" requirement.
      const others = user.emailAddresses.filter((e) => e.id !== pendingAddress.id)
      await Promise.all(others.map((e) => e.destroy().catch(() => {})))

      const token = await getToken()
      if (token) {
        await getAuthClient(token)
          .from('users')
          .update({ email: pendingAddress.emailAddress })
          .eq('clerk_id', user.id)
      }

      onSuccess(pendingAddress.emailAddress)
      reset()
    } catch (err) {
      setError(clerkErrorMessage(err, 'Verification failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{step === 'input' ? 'Change Email' : 'Verify New Email'}</Text>
            <Pressable onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.inkBlack} />
            </Pressable>
          </View>

          {step === 'input' ? (
            <>
              <Text style={styles.subtitle}>
                We'll send a verification code to your new email address.
              </Text>
              <TextInput
                style={styles.input}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="new@email.com"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>
                Enter the code sent to {pendingAddress?.emailAddress}
              </Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={8}
              />
              <Pressable onPress={() => { setStep('input'); setError('') }} hitSlop={8}>
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>
            </>
          )}

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }, loading && { opacity: 0.6 }]}
            onPress={step === 'input' ? handleSendCode : handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.mistWhite} />
            ) : (
              <Text style={styles.submitText}>{step === 'input' ? 'Send Code' : 'Verify & Save'}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 20,
    padding: 20,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 14, lineHeight: 18 },
  input: {
    backgroundColor: colors.cloudGrey,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.steelGrey,
    paddingHorizontal: 14,
    height: 50,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.inkBlack,
    marginBottom: 8,
  },
  linkText: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen, marginBottom: 4 },
  errorText: { fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginTop: 6, marginBottom: 4 },
  submitBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.tealGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  submitText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
})
