import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PENDING_PAYMENT_KEY } from '@/lib/pendingPayment'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import { formatFriendlyDateTime } from '@/lib/dateFormat'
import { formatDoctorName } from '@/lib/nameFormat'

type PageState = 'verifying' | 'confirmed' | 'failed' | 'processing'

// Chapa's payment_status='paid' flip is normally written by chapa-webhook,
// which Chapa calls asynchronously, server-to-server, sometime after this
// screen opens — this app has no control over when (or whether) that
// delivery happens. Previously this screen only ever passively polled our
// own DB for that flip; if Chapa's callback was delayed past 60s, dropped,
// or never configured to reach this environment at all, the row stayed at
// pending_payment forever — no waiting room, no doctor notification (both
// depend on this same flip), and every retry then hit book_appointment_
// slot()'s PATIENT_BUSY guard since the abandoned row still counts as
// "busy". chapa-webhook's GET path (used for Chapa's own browser redirect)
// runs the identical verify-with-Chapa + idempotent DB-write logic as its
// POST path — safe to call directly from the client as an active nudge
// instead of only ever waiting on Chapa's own delivery.
async function triggerActiveVerification(txRef: string) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!supabaseUrl || !txRef) return
  try {
    await fetch(`${supabaseUrl}/functions/v1/chapa-webhook?tx_ref=${encodeURIComponent(txRef)}`, {
      method: 'GET',
      headers: anonKey ? { apikey: anonKey } : undefined,
    })
  } catch {
    // best-effort — the passive poll below still covers Chapa's own callback
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
  const navigatedRef = useRef(false)
  const [processingInfo, setProcessingInfo] = useState<{
    consultationId: string
    txRef: string | null
    doctorId: string
    doctorName: string
    consultationType: string
    timing: string
  } | null>(null)
  const [recheckInFlight, setRecheckInFlight] = useState(false)

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
              id, type, scheduled_at, doctor_id, is_on_demand,
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

          // is_on_demand is set once, authoritatively, by book_appointment_slot()
          // at booking time. A prior `scheduled_at > now + 1h` heuristic
          // misclassified any scheduled slot booked less than an hour ahead
          // (common with 20-minute slots) as on-demand, flipping status to
          // 'waiting_for_doctor' below and stranding the patient in the
          // on-demand waiting room.
          if ((data as any).is_on_demand != null) {
            timing = (data as any).is_on_demand ? 'now' : 'schedule'
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

      // Look up our own tx_ref for this consultation (may already be known
      // from the cold-launch txRef param, but the normal in-app path never
      // receives one) so we can actively nudge chapa-webhook below instead
      // of only ever waiting on Chapa's own async callback.
      let ownTxRef = txRef ?? null
      if (!ownTxRef) {
        try {
          const { data: txRow } = await supabase
            .from('consultations')
            .select('chapa_tx_ref')
            .eq('id', consultationId)
            .maybeSingle()
          ownTxRef = txRow?.chapa_tx_ref ?? null
        } catch {}
      }

      // Fire immediately, in parallel with the passive poll below — this
      // alone resolves the payment within a couple of seconds in the common
      // case where Chapa's async webhook is merely delayed or never
      // configured to reach this environment, closing the exact gap that
      // otherwise left the doctor un-notified and the waiting room never
      // appearing.
      if (ownTxRef) triggerActiveVerification(ownTxRef)

      // Poll DB until payment is marked paid (up to 60 s passive)
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

      if (!paid && initialChapaStatus === 'success' && ownTxRef) {
        // Passive poll exhausted but Chapa's own redirect said success —
        // actively re-verify (idempotent, safe to call repeatedly) and give
        // it one more short window rather than immediately dead-ending on
        // the static "processing" screen.
        await triggerActiveVerification(ownTxRef)
        let retryAttempts = 0
        while (retryAttempts < 15) {
          if (cancelledRef.current) return
          const { data } = await supabase
            .from('consultations')
            .select('payment_status')
            .eq('id', consultationId)
            .single()
          if (data?.payment_status === 'paid') { paid = true; break }
          retryAttempts++
          await new Promise<void>(resolve => setTimeout(resolve, 2000))
        }
      }

      if (cancelledRef.current) return

      if (!paid) {
        if (initialChapaStatus === 'success') {
          // Chapa said success but both the passive poll and the active
          // re-verify above came back empty — genuinely unresolved (Chapa
          // API itself unreachable, or the transaction really isn't settled
          // yet). Leave the row open rather than cancelling a possibly-paid
          // booking; the "processing" screen's retry action can nudge again.
          setProcessingInfo({ consultationId, txRef: ownTxRef, doctorId, doctorName, consultationType, timing })
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
      //
      // Guarded to only flip a row still at 'pending_payment': this poll loop
      // can take up to a minute, and the chapa-webhook function runs the same
      // flip (guarded the same way) the moment it verifies payment — usually
      // seconds before this client-side poll even notices payment_status is
      // 'paid'. If the doctor accepts in that window, this write would
      // otherwise land after them and silently overwrite 'accepted'/
      // 'in_progress' back to 'waiting_for_doctor' — resurrecting the
      // doctor's incoming-request modal for a call they already answered and
      // yanking the patient back into a waiting room for a consultation
      // that's actually already live.
      let liveStatus: string | null = null
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
            .eq('status', 'pending_payment')
            .eq('payment_status', 'paid')
        }
        const { data: statusRow } = await supabase
          .from('consultations')
          .select('status')
          .eq('id', consultationId)
          .single()
        liveStatus = statusRow?.status ?? null
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
        // Routes off whatever status is passed in — never off state captured
        // earlier — so a decision made after a delay (realtime event, the
        // fallback timer below) always reflects what's actually in the DB
        // right now, not what it was when this screen started waiting.
        const navigateForStatus = (status: string | null) => {
          if (navigatedRef.current || cancelledRef.current) return
          if (status === 'accepted' || status === 'in_progress' || status === 'active') {
            navigatedRef.current = true
            const route =
              consultationType === 'phone' ? '/(patient)/phone-consultation' :
              consultationType === 'video' ? '/(patient)/video-consultation' :
              '/(patient)/chat-consultation'
            router.replace({
              pathname: route as any,
              params: { channelId: consultationId, consultationId, doctorId, doctorName, doctorPhotoUrl: '' },
            })
          } else if (status === 'completed') {
            navigatedRef.current = true
            router.replace({
              pathname: '/(patient)/consultation-summary' as any,
              params: { consultationId, doctorId, doctorName, consultationType },
            })
          } else if (status && status !== 'pending_payment') {
            // waiting_for_doctor, declined, cancelled, missed, call_declined,
            // ended_abnormally — the waiting room already owns the correct
            // UI (including the credit screen) for every one of these, so
            // route there rather than duplicating that logic here.
            navigatedRef.current = true
            router.replace({
              pathname: '/(patient)/waiting-room',
              params: { consultationId, doctorId, doctorName, consultationType },
            })
          }
        }

        // The doctor may accept (or decline) while this screen is showing
        // "Payment Successful" — subscribe so that transition is caught the
        // instant it happens instead of only being noticed by the
        // fixed-delay fallback below, which would otherwise still be able to
        // send the patient into the waiting room for a call already answered.
        const channel = supabase
          .channel(`payment-return-${consultationId}-${Date.now()}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` },
            (payload) => navigateForStatus((payload.new as any)?.status ?? null),
          )
          .subscribe()

        // Navigate immediately if the doctor already acted before we even
        // finished payment verification.
        navigateForStatus(liveStatus)

        if (!navigatedRef.current) {
          await new Promise<void>(resolve => setTimeout(resolve, 2500))
          if (!cancelledRef.current && !navigatedRef.current) {
            // Re-fetch rather than reusing `liveStatus` — it was captured
            // before this wait, and the doctor may have accepted since.
            const { data: freshRow } = await supabase
              .from('consultations')
              .select('status')
              .eq('id', consultationId)
              .single()
            navigateForStatus(freshRow?.status ?? 'waiting_for_doctor')
          }
        }

        supabase.removeChannel(channel)
      } else {
        // Scheduled bookings stay on the confirmation screen — the patient
        // taps "Continue" (handleContinueToAppointments) to go to their
        // upcoming appointment instead of being auto-redirected. Reminders
        // for this booking (5-minute and start-time) are sent server-side by
        // the appointment-notification cron — no client-local scheduling
        // needed here, which previously duplicated those same pushes.
      }
    }

    run()

    return () => { cancelledRef.current = true }
  }, [paramConsultationId, txRef])

  async function handleManualRecheck() {
    if (!processingInfo || recheckInFlight) return
    setRecheckInFlight(true)
    try {
      if (processingInfo.txRef) await triggerActiveVerification(processingInfo.txRef)

      let paid = false
      for (let i = 0; i < 5 && !paid; i++) {
        const { data } = await supabase
          .from('consultations')
          .select('payment_status')
          .eq('id', processingInfo.consultationId)
          .single()
        if (data?.payment_status === 'paid') { paid = true; break }
        await new Promise<void>(resolve => setTimeout(resolve, 2000))
      }

      if (!paid) {
        Alert.alert('Still Processing', 'Your payment has not been confirmed yet. Please try again in a moment.')
        return
      }

      const { data: statusRow } = await supabase
        .from('consultations')
        .select('status')
        .eq('id', processingInfo.consultationId)
        .single()
      const liveStatus = statusRow?.status

      if (processingInfo.timing === 'now') {
        const route =
          processingInfo.consultationType === 'phone' ? '/(patient)/phone-consultation' :
          processingInfo.consultationType === 'video' ? '/(patient)/video-consultation' :
          '/(patient)/chat-consultation'
        if (liveStatus === 'accepted' || liveStatus === 'in_progress' || liveStatus === 'active') {
          router.replace({
            pathname: route as any,
            params: {
              channelId: processingInfo.consultationId, consultationId: processingInfo.consultationId,
              doctorId: processingInfo.doctorId, doctorName: processingInfo.doctorName, doctorPhotoUrl: '',
            },
          })
        } else {
          router.replace({
            pathname: '/(patient)/waiting-room',
            params: {
              consultationId: processingInfo.consultationId,
              doctorId: processingInfo.doctorId,
              doctorName: processingInfo.doctorName,
              consultationType: processingInfo.consultationType,
            },
          })
        }
      } else {
        router.replace('/(patient)/(tabs)/appointments')
      }
    } finally {
      setRecheckInFlight(false)
    }
  }

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
        ? formatFriendlyDateTime(confirmedDetails.scheduledAt)
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
                <Text style={styles.detailValue}>{formatDoctorName(confirmedDetails?.doctorName)}</Text>
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
              <Text style={styles.detailValue}>{formatDoctorName(confirmedDetails?.doctorName)}</Text>
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
          <Pressable
            onPress={handleManualRecheck}
            disabled={recheckInFlight}
            style={[styles.continueButton, recheckInFlight && { opacity: 0.6 }]}
          >
            {recheckInFlight
              ? <ActivityIndicator color={colors.mistWhite} />
              : <Text style={styles.continueButtonText}>Check Now</Text>}
          </Pressable>
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
