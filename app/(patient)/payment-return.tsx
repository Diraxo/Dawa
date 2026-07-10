import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PENDING_PAYMENT_KEY } from '@/lib/pendingPayment'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'

type PageState = 'verifying' | 'confirmed' | 'failed' | 'processing'

// Mirrors the date/time formatting used on the appointments tab
// (dateLbl/timeLbl in app/(patient)/(tabs)/appointments.tsx) so the
// "scheduled for" copy here reads the same way as the rest of the app.
function formatScheduledAt(iso: string): string {
  const d = new Date(iso)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${dateStr} at ${timeStr}`
}

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

  // Normal in-app navigation provides all params.
  // Fresh app launch from deep link (after external bank app redirect) only
  // provides tx_ref and status — we resolve the rest from the DB.
  const {
    consultationId:   paramConsultationId,
    doctorId:         paramDoctorId,
    doctorName:       paramDoctorName,
    consultationType: paramConsultationType,
    chapaStatus:      paramChapaStatus,
    timing:           paramTiming,
    scheduledAt:      paramScheduledAt,
    tx_ref:           txRef,
    status:           deepLinkStatus,
  } = useLocalSearchParams<{
    consultationId?:   string
    doctorId?:         string
    doctorName?:       string
    consultationType?: string
    chapaStatus?:      string
    timing?:           string
    scheduledAt?:      string
    tx_ref?:           string
    status?:           string
  }>()

  const [state, setState] = useState<PageState>('verifying')
  const [confirmedDetails, setConfirmedDetails] = useState<{
    doctorName: string
    consultationType: string
    amount: number | null
    timing: string
    scheduledAt: string
  } | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    AsyncStorage.removeItem(PENDING_PAYMENT_KEY).catch(() => {})

    async function run() {
      // ── Resolve params ──────────────────────────────────────────────────────
      // When the app opens fresh from the carehub://payment-return deep link,
      // only tx_ref and status are present. Look up the consultation by tx_ref.
      let consultationId = paramConsultationId
      let doctorId       = paramDoctorId       ?? ''
      let doctorName     = paramDoctorName     ?? 'Doctor'
      let consultationType = paramConsultationType ?? 'chat'
      let timing         = paramTiming         ?? 'now'
      let scheduledAt    = paramScheduledAt    ?? ''
      const initialChapaStatus = paramChapaStatus ?? deepLinkStatus ?? 'unknown'

      if (!consultationId && txRef) {
        try {
          const token = await getToken()
          if (!token) { setState('failed'); return }

          const { data } = await getAuthClient(token)
            .from('consultations')
            .select(`
              id, type, scheduled_at, doctor_id,
              doctor_profiles!doctor_id(users!inner(full_name))
            `)
            .eq('chapa_tx_ref', txRef)
            .maybeSingle()

          if (cancelledRef.current) return
          if (!data) { setState('failed'); return }

          consultationId   = (data as any).id
          doctorId         = (data as any).doctor_id ?? ''
          doctorName       = (data as any).doctor_profiles?.users?.full_name ?? 'Doctor'
          consultationType = (data as any).type ?? 'chat'
          scheduledAt      = (data as any).scheduled_at ?? ''

          // Determine timing: more than 1 h in the future → scheduled
          if (scheduledAt) {
            const scheduledTime = new Date(scheduledAt)
            timing = scheduledTime > new Date(Date.now() + 60 * 60 * 1000) ? 'schedule' : 'now'
          }
        } catch {
          if (!cancelledRef.current) setState('failed')
          return
        }
      }

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
        await cancelConsultationById(consultationId)
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
          await cancelConsultationById(consultationId)
          setState('failed')
        }
        return
      }

      // "Now" bookings go straight to waiting_for_doctor (triggers the doctor
      // notification immediately). Scheduled bookings become 'scheduled' —
      // the scheduled-time cron (trigger_appointment_notifications) flips
      // them to waiting_for_doctor only once scheduled_at arrives.
      //
      // waiting_started_at must be stamped here too, same as the credit path
      // in apply-credit/index.ts — it's the sort key doctor clients queue on
      // and what the patient waiting room displays as "waiting since".
      try {
        const token = await getToken()
        if (token && consultationId) {
          await getAuthClient(token)
            .from('consultations')
            .update({
              status: timing === 'now' ? 'waiting_for_doctor' : 'scheduled',
              ...(timing === 'now' ? { waiting_started_at: new Date().toISOString() } : {}),
            })
            .eq('id', consultationId)
            .eq('payment_status', 'paid')
        }
      } catch {
        // best-effort; the waiting room can still function
      }

      // Fetch the amount actually charged so the confirmation screen can show
      // doctor / type / amount / status together — route params never carry
      // amount (BookingModal doesn't pass it), and the txRef DB lookup above
      // only runs for the cold-launch deep-link case.
      let amount: number | null = null
      try {
        const { data: amountRow } = await supabase
          .from('consultations')
          .select('patient_amount')
          .eq('id', consultationId)
          .single()
        amount = amountRow?.patient_amount != null ? Number(amountRow.patient_amount) : null
      } catch {}
      if (cancelledRef.current) return

      setConfirmedDetails({ doctorName, consultationType, amount, timing, scheduledAt })
      setState('confirmed')

      if (timing === 'now') {
        await new Promise<void>(resolve => setTimeout(resolve, 2500))
        if (cancelledRef.current) return
        router.replace({
          pathname: '/(patient)/waiting-room',
          params: {
            consultationId,
            doctorId,
            doctorName,
            consultationType,
          },
        })
      } else {
        // Scheduled bookings stay on the confirmation screen — the patient
        // taps "Continue" (handleContinueToAppointments) to go to their
        // upcoming appointment instead of being auto-redirected.
        if (scheduledAt) {
          await scheduleReminders(consultationId, scheduledAt, doctorName, consultationType)
        }
      }
    }

    run()

    return () => { cancelledRef.current = true }
  }, [paramConsultationId, txRef])

  async function cancelConsultationById(id: string) {
    try {
      const token = await getToken()
      if (token && id) {
        await getAuthClient(token)
          .from('consultations')
          .update({ status: 'cancelled' })
          .eq('id', id)
          .eq('payment_status', 'pending')
      }
    } catch {}
  }

  function handleContinueToAppointments() {
    cancelledRef.current = true
    router.replace('/(patient)/(tabs)/appointments')
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
            const id = paramConsultationId
            if (id) await cancelConsultationById(id)
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
    const typeLabel =
      confirmedDetails?.consultationType === 'phone' ? 'Phone Consultation' :
      confirmedDetails?.consultationType === 'video' ? 'Video Consultation' :
      'Chat Consultation'

    // Scheduled bookings get a distinct confirmation panel — no auto
    // waiting-room copy, and the patient explicitly continues on to their
    // upcoming appointment rather than being auto-redirected.
    if (confirmedDetails?.timing === 'schedule') {
      const formattedWhen = confirmedDetails.scheduledAt
        ? formatScheduledAt(confirmedDetails.scheduledAt)
        : null
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.center}>
            <View style={[styles.iconWrap, styles.iconSuccess]}>
              <Ionicons name="checkmark" size={42} color={colors.mistWhite} />
            </View>
            <Text style={styles.title}>Appointment Scheduled</Text>
            <Text style={styles.sub}>
              Your appointment is scheduled for{' '}
              {formattedWhen ? <Text style={styles.subBold}>{formattedWhen}</Text> : 'the selected time'}
            </Text>

            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Doctor</Text>
                <Text style={styles.detailValue}>{confirmedDetails?.doctorName ?? 'Doctor'}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Type</Text>
                <Text style={styles.detailValue}>{typeLabel}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Amount Paid</Text>
                <Text style={styles.detailValue}>
                  {confirmedDetails?.amount != null ? `ETB ${confirmedDetails.amount.toFixed(2)}` : '—'}
                </Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={[styles.detailValue, { color: colors.success }]}>Paid</Text>
              </View>
            </View>

            <Text style={styles.hint}>We'll notify you when it's time for your consultation.</Text>

            <Pressable onPress={handleContinueToAppointments} style={styles.continueButton}>
              <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      )
    }

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={[styles.iconWrap, styles.iconSuccess]}>
            <Ionicons name="checkmark" size={42} color={colors.mistWhite} />
          </View>
          <Text style={styles.title}>Payment Successful</Text>
          <Text style={styles.sub}>Payment Verified</Text>

          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Doctor</Text>
              <Text style={styles.detailValue}>{confirmedDetails?.doctorName ?? 'Doctor'}</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Type</Text>
              <Text style={styles.detailValue}>{typeLabel}</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Amount Paid</Text>
              <Text style={styles.detailValue}>
                {confirmedDetails?.amount != null ? `ETB ${confirmedDetails.amount.toFixed(2)}` : '—'}
              </Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Status</Text>
              <Text style={[styles.detailValue, { color: colors.success }]}>Paid</Text>
            </View>
          </View>

          <Text style={styles.hint}>Taking you to the waiting room…</Text>
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
  detailsCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 16, marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  detailLabel: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  detailValue: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
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
  subBold: {
    fontFamily: fonts.semiBold,
    color: colors.mistWhite,
  },
  continueButton: {
    width: '100%',
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.interactiveBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.mistWhite,
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
