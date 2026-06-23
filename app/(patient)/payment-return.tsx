import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'

type PageState = 'verifying' | 'confirmed' | 'failed' | 'processing'

async function scheduleReminders(
  consultationId: string,
  scheduledAt: string,
  doctorName: string,
  consultationType: string,
) {
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return
    const apptTime = new Date(scheduledAt)
    const fiveMin = new Date(apptTime.getTime() - 5 * 60 * 1000)
    const now = new Date()
    const channelId = Platform.OS === 'android' ? 'appointments' : undefined
    if (fiveMin > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Appointment Reminder',
          body: `Your ${consultationType} consultation with ${doctorName} starts in 5 minutes`,
          data: { consultationId },
          ...(channelId ? { channelId } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fiveMin },
      })
    }
    if (apptTime > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "It's Time for Your Consultation",
          body: `Your ${consultationType} consultation with ${doctorName} is starting now. Tap to join.`,
          data: { consultationId },
          ...(channelId ? { channelId } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: apptTime },
      })
    }
  } catch {
    // notifications are best-effort
  }
}

export default function PaymentReturnScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const {
    consultationId,
    doctorId,
    doctorName,
    consultationType,
    chapaStatus: initialChapaStatus,
    timing,
    scheduledAt,
  } = useLocalSearchParams<{
    consultationId: string
    doctorId: string
    doctorName: string
    consultationType: string
    chapaStatus: string
    timing: string
    scheduledAt: string
  }>()

  const [state, setState] = useState<PageState>('verifying')
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false

    async function run() {
      if (!consultationId) {
        setState('failed')
        return
      }

      // Chapa explicitly signalled failure — cancel immediately, no need to poll
      if (
        initialChapaStatus === 'failed' ||
        initialChapaStatus === 'payment_failed' ||
        initialChapaStatus === 'cancelled'
      ) {
        await cancelConsultation()
        setState('failed')
        return
      }

      // Poll DB until webhook marks payment as paid (up to 60 s)
      const MAX_ATTEMPTS = 30
      let attempts = 0
      let paid = false

      while (attempts < MAX_ATTEMPTS) {
        if (cancelledRef.current) return

        const { data } = await supabase
          .from('consultations')
          .select('payment_status')
          .eq('id', consultationId)
          .single()

        if (data?.payment_status === 'paid') {
          paid = true
          break
        }

        attempts++
        await new Promise<void>(resolve => setTimeout(resolve, 2000))
      }

      if (cancelledRef.current) return

      if (!paid) {
        if (initialChapaStatus === 'success') {
          // Chapa said success but webhook is delayed — leave open, show processing
          setState('processing')
        } else {
          await cancelConsultation()
          setState('failed')
        }
        return
      }

      // Update status to waiting_for_doctor — this triggers the doctor notification
      try {
        const token = await getToken()
        if (token && consultationId) {
          await getAuthClient(token)
            .from('consultations')
            .update({ status: 'waiting_for_doctor' })
            .eq('id', consultationId)
            .eq('payment_status', 'paid')
        }
      } catch {
        // best-effort; the waiting room can still function
      }

      setState('confirmed')
      await new Promise<void>(resolve => setTimeout(resolve, 1500))
      if (cancelledRef.current) return

      if (timing === 'now') {
        router.replace({
          pathname: '/(patient)/waiting-room',
          params: {
            consultationId,
            doctorId,
            doctorName:       doctorName   ?? 'Doctor',
            consultationType: consultationType ?? 'chat',
          },
        })
      } else {
        if (scheduledAt) {
          await scheduleReminders(consultationId, scheduledAt, doctorName ?? 'Doctor', consultationType ?? 'chat')
        }
        router.replace('/(patient)/(tabs)/appointments')
      }
    }

    run()

    return () => { cancelledRef.current = true }
  }, [consultationId])

  async function cancelConsultation() {
    try {
      const token = await getToken()
      if (token && consultationId) {
        await getAuthClient(token)
          .from('consultations')
          .update({ status: 'cancelled' })
          .eq('id', consultationId)
          .eq('payment_status', 'pending')
      }
    } catch {}
  }

  async function handleManualCancel() {
    Alert.alert(
      'Cancel Payment?',
      'Are you sure you did not complete payment? Your booking will be removed.',
      [
        { text: 'Keep waiting', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            cancelledRef.current = true
            await cancelConsultation()
            router.back()
          },
        },
      ],
    )
  }

  // ── Verifying ────────────────────────────────────────────────────────────────
  if (state === 'verifying') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.iconWrap}>
            <ActivityIndicator size="large" color={colors.interactiveBlue} />
          </View>
          <Text style={styles.title}>Verifying Payment</Text>
          <Text style={styles.sub}>Confirming your payment with Chapa…</Text>
          <Text style={styles.hint}>This usually takes just a few seconds.</Text>
          <Pressable onPress={handleManualCancel} style={styles.cancelLink}>
            <Text style={styles.cancelLinkText}>I didn't complete payment</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  // ── Confirmed ────────────────────────────────────────────────────────────────
  if (state === 'confirmed') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={[styles.iconWrap, styles.iconSuccess]}>
            <Ionicons name="checkmark" size={42} color={colors.mistWhite} />
          </View>
          <Text style={styles.title}>Payment Confirmed!</Text>
          <Text style={styles.sub}>
            {timing === 'now'
              ? 'Taking you to the waiting room…'
              : 'Your appointment has been booked.'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Webhook delayed (Chapa said success, DB not updated yet) ─────────────────
  if (state === 'processing') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={[styles.iconWrap, styles.iconWarning]}>
            <Ionicons name="time-outline" size={42} color={colors.mistWhite} />
          </View>
          <Text style={styles.title}>Payment Processing</Text>
          <Text style={styles.sub}>
            Your payment was received but is still being confirmed.
            Check your appointments in a few minutes — your booking will appear once confirmed.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Failed / cancelled ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, styles.iconFailed]}>
          <Ionicons name="close" size={42} color={colors.mistWhite} />
        </View>
        <Text style={styles.title}>Payment Failed</Text>
        <Text style={styles.sub}>
          Your payment was not completed. No charge has been made. Please try again.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#070E27',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: `${colors.interactiveBlue}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconSuccess: { backgroundColor: colors.success },
  iconWarning: { backgroundColor: '#D97706' },
  iconFailed:  { backgroundColor: colors.error },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.mistWhite,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 22,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    marginTop: 4,
  },
  cancelLink: {
    marginTop: 28,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelLinkText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
})
