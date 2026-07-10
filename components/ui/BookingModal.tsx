import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useRef, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Doctor } from '@/components/ui/DoctorCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { getAuthClient, supabase } from '@/lib/supabase'
import { PENDING_PAYMENT_KEY } from '@/lib/pendingPayment'
import {
  SLOT_DURATION_MINS,
  formatTimeMins,
  isSlotPast,
  getAvailableSlots,
  getNextDays,
  parseScheduledAt,
} from '@/lib/slotGeneration'

type ConsultationType = 'chat' | 'phone' | 'video'
type TimingType = 'now' | 'schedule'

interface ActiveCredit {
  creditConsultationId: string
  creditAmount:         number
  type:                 ConsultationType
}

type Props = {
  visible: boolean
  doctor: Doctor | null
  onClose: () => void
}

const CONSULT_TYPES: { id: ConsultationType; label: string; icon: string; color: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'chatbubble-ellipses', color: colors.tealGreen },
  { id: 'phone', label: 'Phone Call', icon: 'call', color: colors.careBlue },
  { id: 'video', label: 'Video Call', icon: 'videocam', color: '#7C3AED' },
]

// Bounds any promise that has no built-in timeout (Clerk's getToken(), plain
// supabase-js calls without an abortSignal) — without this, a stalled request
// left the booking button stuck on its loading state forever with no error
// and no way to recover.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

export function BookingModal({ visible, doctor, onClose }: Props) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const slideAnim = useRef(new Animated.Value(300)).current
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [consultType, setConsultType] = useState<ConsultationType>('chat')
  const [timing, setTiming] = useState<TimingType>('now')
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [activeCredit, setActiveCredit] = useState<ActiveCredit | null>(null)
  const [creditLoading, setCreditLoading] = useState(false)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [bookedTimes, setBookedTimes] = useState<Set<string>>(new Set())
  const days = getNextDays(14, doctor?.availability ?? undefined)
  const selectedDayValue = days[selectedDay]?.value

  const canStartNow = Boolean(doctor?.is_online) && !doctorBusy

  // Doctor is BUSY when they already have an accepted/in-progress consultation.
  // Checked via RPC (not a direct table read) so a patient never needs SELECT
  // access to another patient's consultation row just to see a boolean.
  const checkDoctorBusy = async (doctorId: string) => {
    const { data } = await supabase.rpc('is_doctor_busy', { p_doctor_id: doctorId })
    return Boolean(data)
  }

  // Poll busy state while the sheet is open — mirrors the "Start Now stopped
  // being valid" pattern below (doctor going offline/disabling on-demand),
  // but for the busy condition, which can only be observed via the RPC.
  useEffect(() => {
    if (!visible || !doctor) return
    let cancelled = false
    checkDoctorBusy(doctor.id).then(busy => { if (!cancelled) setDoctorBusy(busy) })
    const interval = setInterval(() => {
      checkDoctorBusy(doctor.id).then(busy => { if (!cancelled) setDoctorBusy(busy) })
    }, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [visible, doctor?.id])

  // Which generated time slots for the selected day are already booked, so
  // they can be shown locked/disabled instead of only failing at submit time
  // with the server's SLOT_TAKEN error (which remains as defense-in-depth).
  // Re-runs whenever the doctor, sheet visibility, timing mode, or selected
  // day changes. slot_locks (not consultations, which RLS restricts to a
  // patient's own rows) is the readable-by-any-patient source of truth here.
  useEffect(() => {
    if (!visible || !doctor || timing !== 'schedule' || !selectedDayValue) {
      setBookedTimes(new Set())
      return
    }
    let cancelled = false
    const dayStart = new Date(`${selectedDayValue}T00:00:00`)
    const dayEnd = new Date(`${selectedDayValue}T23:59:59.999`)

    const fetchBookedTimes = () => {
      supabase
        .from('slot_locks')
        .select('slot_start')
        .eq('doctor_id', doctor.id)
        .gte('slot_start', dayStart.toISOString())
        .lte('slot_start', dayEnd.toISOString())
        .gt('expires_at', new Date().toISOString())
        .then(({ data, error }) => {
          if (cancelled) return
          if (error || !data) {
            setBookedTimes(new Set())
            return
          }
          setBookedTimes(new Set(
            data.map((row: any) => {
              const d = new Date(row.slot_start)
              return formatTimeMins(d.getHours() * 60 + d.getMinutes())
            })
          ))
        })
    }

    fetchBookedTimes()

    // Another patient booking/cancelling the same day while this sheet is
    // already open must flip that slot's availability live — without this,
    // only re-opening the sheet (or changing day and back) picked it up.
    const channel = supabase
      .channel(`booking-slot-locks-${doctor.id}-${selectedDayValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_locks', filter: `doctor_id=eq.${doctor.id}` },
        () => fetchBookedTimes()
      )
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [visible, doctor?.id, timing, selectedDayValue])

  useEffect(() => {
    if (visible) {
      setStep(1)
      setConsultType('chat')
      setTiming(canStartNow ? 'now' : 'schedule')
      setSelectedDay(0)
      setSelectedTime('')
      setConfirming(false)
      setPaying(false)
      setActiveCredit(null)
      setCreditLoading(false)
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
    } else {
      Animated.timing(slideAnim, { toValue: 300, duration: 220, useNativeDriver: true }).start()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // "Start Now" stopped being valid while the modal is open (doctor went
  // offline) — fall back to scheduling for later.
  useEffect(() => {
    if (visible && !canStartNow && timing === 'now') {
      setTiming('schedule')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartNow, visible])

  // Check for active consultation credit as soon as the sheet opens — not
  // just at the review step — so Step 1's type selector can be locked to the
  // credit's original consultation type from the start. A credit is only
  // ever redeemable against the SAME type it was paid for (never converted
  // chat -> video, etc.), so consultType is force-set here too.
  useEffect(() => {
    if (!visible || !user) return
    let cancelled = false
    setCreditLoading(true)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const client = getAuthClient(token)

        const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!userData || cancelled) return

        const { data: credits } = await client
          .from('consultations')
          .select('id, credit_amount, type')
          .eq('patient_id', userData.id)
          .eq('consultation_credit', true)
          .eq('credit_used', false)
          .order('created_at', { ascending: false })
          .limit(1)

        if (cancelled) return
        if (credits && credits.length > 0) {
          const creditType = (credits[0].type ?? 'chat') as ConsultationType
          setActiveCredit({
            creditConsultationId: credits[0].id,
            creditAmount:         Number(credits[0].credit_amount ?? 0),
            type:                 creditType,
          })
          setConsultType(creditType)
        } else {
          setActiveCredit(null)
        }
      } catch {
        // credit check is best-effort
      } finally {
        if (!cancelled) setCreditLoading(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!doctor) return null

  const getPrice = (type: ConsultationType) => {
    if (type === 'chat') return doctor.chat_price
    if (type === 'phone') return doctor.phone_price
    return doctor.video_price
  }

  const selectedType = CONSULT_TYPES.find(t => t.id === consultType)!
  const newFee = getPrice(consultType)
  const creditCoversAll = activeCredit !== null && newFee <= activeCredit.creditAmount
  const additionalRequired = activeCredit ? Math.max(0, newFee - activeCredit.creditAmount) : newFee

  // ── Apply full credit (no Chapa needed) ──────────────────────────────────
  const applyFullCredit = async (consultationId: string, creditConsultationId: string) => {
    const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? ''
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const clerkToken      = await withTimeout(getToken(), 15000, 'Connection timed out. Please check your network and try again.')

    // Bounded with a timeout — without it, a stalled network/edge-function
    // call left this promise unresolved forever, stranding the UI on
    // "Applying your credit…" with no way to recover (see initialize-payment
    // below, which has always had this same protection).
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 20_000)

    let resp: Response
    try {
      resp = await fetch(`${supabaseUrl}/functions/v1/apply-credit`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${clerkToken}`,
          'apikey':        supabaseAnonKey,
        },
        body: JSON.stringify({
          credit_consultation_id: creditConsultationId,
          new_consultation_id:    consultationId,
        }),
      })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Applying your credit timed out. Please try again.')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
    const data = await resp.json()
    if (!resp.ok) throw new Error(data?.error ?? 'Failed to apply credit')
    return data
  }

  const initiateChapaPayment = async () => {
    setPaying(true)
    let consultationId: string | null = null
    const chargeAmount = creditCoversAll ? 0 : additionalRequired

    // Set up Linking listener BEFORE opening the browser so we catch the
    // carehub:// deep link even when Chapa's flow goes through an external
    // banking app (CBE Birr, Telebirr, etc.) that breaks the
    // ASWebAuthenticationSession context.
    // carehub://payment-return matches app/(patient)/payment-return.tsx via
    // Expo Router (route groups are transparent in URL paths).
    const deepLinkReturn = 'carehub://payment-return'
    let capturedLinkingUrl: string | null = null
    let resolveLinking: (url: string) => void = () => {}
    const linkingPromise = new Promise<string>(res => { resolveLinking = res })
    const linkingSub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith(deepLinkReturn)) {
        capturedLinkingUrl = url
        resolveLinking(url)
      }
    })

    const navigateToReturn = (chapaStatus: string, id: string, scheduledAt: string) => {
      onClose()
      router.push({
        pathname: '/(patient)/payment-return',
        params: {
          consultationId:   id,
          doctorId:         doctor.id,
          doctorName:       doctor.name,
          consultationType: consultType,
          chapaStatus,
          timing,
          scheduledAt: timing !== 'now' ? scheduledAt : '',
        },
      })
    }

    try {
      const token = await withTimeout(getToken(), 15000, 'Connection timed out. Please check your network and try again.')
      if (!token || !user) throw new Error('Not authenticated')

      const client = getAuthClient(token)

      const { data: userData, error: userErr } = await withTimeout(
        client.from('users').select('id').eq('clerk_id', user.id).single(),
        15000,
        'Connection timed out. Please check your network and try again.',
      )

      if (userErr || !userData) throw new Error('Could not find your user profile.')

      // Final busy re-check right before payment — the periodic poll above
      // could be stale by up to 10s, and the patient must never be charged
      // for an On-Demand consultation with a doctor who became busy in that
      // window. book_appointment_slot() also enforces this server-side
      // (DOCTOR_BUSY below) as the authoritative last-resort guard.
      if (timing === 'now' && await checkDoctorBusy(doctor.id)) {
        setDoctorBusy(true)
        Alert.alert(
          'Doctor Busy',
          'Doctor is currently in another consultation.',
          [
            { text: 'Choose Another Doctor', style: 'cancel', onPress: () => onClose() },
            { text: 'Schedule for Later', onPress: () => { setTiming('schedule'); setStep(2) } },
          ],
        )
        return
      }

      const scheduledAt = timing === 'now'
        ? new Date().toISOString()
        : parseScheduledAt(days[selectedDay].value, selectedTime)

      const price = getPrice(consultType)

      // Atomically claims the slot (prevents two patients double-booking the
      // same doctor at the same scheduled time) before creating the row.
      const { data: newConsultationId, error: consultErr } = await withTimeout(
        client.rpc('book_appointment_slot', {
          p_patient_id:      userData.id,
          p_doctor_id:       doctor.id,
          p_type:            consultType,
          p_slot_start:      scheduledAt,
          p_slot_duration:   SLOT_DURATION_MINS,
          p_patient_amount:  price,
          p_is_on_demand:    timing === 'now',
        }),
        15000,
        'Booking request timed out. Please check your connection and try again.',
      )

      if (consultErr || !newConsultationId) {
        const msg = consultErr?.message ?? ''
        if (msg.includes('SLOT_TAKEN')) {
          throw new Error('This time slot was just booked by someone else. Please pick another time.')
        }
        if (msg.includes('ON_DEMAND_DISABLED')) {
          throw new Error('This doctor is not accepting on-demand consultations right now.')
        }
        if (msg.includes('DOCTOR_BUSY')) {
          throw new Error('Doctor is currently in another consultation. Please schedule for later or choose another doctor.')
        }
        if (msg.includes('PATIENT_BUSY')) {
          throw new Error('You already have an active consultation. Please finish it before starting a new one.')
        }
        if (msg.includes('SCHEDULED_DISABLED')) {
          throw new Error('This doctor is not accepting scheduled appointments right now.')
        }
        if (msg.includes('DAY_OFF')) {
          throw new Error('This doctor is not available on the selected day.')
        }
        if (msg.includes('DATE_BLOCKED')) {
          throw new Error('This doctor is unavailable on the selected date.')
        }
        if (msg.includes('OUTSIDE_HOURS')) {
          throw new Error('This time is outside the doctor\'s working hours. Please pick another time.')
        }
        throw new Error('Failed to create booking. Please try again.')
      }
      consultationId = newConsultationId as string

      const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? ''
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

      // ── Full credit coverage — skip Chapa entirely ───────────────────────
      if (creditCoversAll && activeCredit) {
        await applyFullCredit(consultationId, activeCredit.creditConsultationId)
        onClose()
        // "Now" bookings go straight to the waiting room. Scheduled bookings
        // must not — apply-credit already left status='scheduled' for these,
        // matching the Chapa path in payment-return.tsx.
        if (timing === 'now') {
          router.push({
            pathname: '/(patient)/waiting-room',
            params: {
              consultationId,
              doctorId:         doctor.id,
              doctorName:       doctor.name,
              consultationType: consultType,
            },
          })
        } else {
          router.push('/(patient)/(tabs)/appointments')
        }
        return
      }

      // ── Partial credit — call apply-credit first (stores credit_source_id) ─
      if (activeCredit) {
        await applyFullCredit(consultationId, activeCredit.creditConsultationId)
          .catch(() => { /* partial credit already stored even if marking fails */ })
      }

      // Chapa requires an https:// return_url and strips all custom query params it
      // didn't add — so we use the bare edge function URL with no extra params.
      // The edge function always 302-redirects to carehub://payment/return which
      // ASWebAuthenticationSession intercepts (matching deepLinkReturn sentinel below).
      const chapaReturnUrl = `${supabaseUrl}/functions/v1/payment-redirect`

      const controller = new AbortController()
      const timeoutId  = setTimeout(() => controller.abort(), 30_000)

      let payResp: Response
      try {
        payResp = await fetch(`${supabaseUrl}/functions/v1/initialize-payment`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey':        supabaseAnonKey,
          },
          body: JSON.stringify({
            consultation_id:  consultationId,
            amount:           chargeAmount > 0 ? chargeAmount : price,
            email:            user.primaryEmailAddress?.emailAddress ?? '',
            first_name:       user.firstName  ?? 'Patient',
            last_name:        user.lastName   ?? user.firstName ?? 'User',
            type:             consultType,
            doctor_name:      doctor.name,
            return_url:       chapaReturnUrl,
            ...(activeCredit ? { credit_source_id: activeCredit.creditConsultationId } : {}),
          }),
        })
      } finally {
        clearTimeout(timeoutId)
      }

      let payData: any
      try { payData = await payResp.json() } catch { payData = {} }

      if (!payResp.ok || !payData?.checkout_url) {
        const raw = payData?.error
        const msg = typeof raw === 'string' && raw.length
          ? raw
          : typeof raw === 'object' && raw !== null
            ? JSON.stringify(raw)
            : `Payment initialization failed (HTTP ${payResp.status}). Please try again.`
        throw new Error(msg)
      }

      // Persist before opening the checkout — if the app gets killed while
      // an external banking app (CBE Birr, Telebirr) is in front and the OS
      // later relaunches us fresh, splash.tsx reads this to route straight
      // back to payment-return instead of defaulting to Home.
      try {
        await AsyncStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
          consultationId,
          doctorId:         doctor.id,
          doctorName:       doctor.name,
          consultationType: consultType,
          timing,
          scheduledAt: timing !== 'now' ? scheduledAt : '',
        }))
      } catch {}

      // Open Chapa checkout. deepLinkReturn is the sentinel: when the web
      // return page does window.location.replace('carehub://...'), the
      // in-app browser catches it and resolves with type:'success'.
      const result = await WebBrowser.openAuthSessionAsync(payData.checkout_url, deepLinkReturn)

      // ── Success: deep-link caught inside ASWebAuthenticationSession ────────
      if (result.type === 'success') {
        let chapaStatus = 'unknown'
        try {
          const urlObj = new URL(result.url ?? '')
          chapaStatus = urlObj.searchParams.get('status') ?? 'unknown'
        } catch {}
        navigateToReturn(chapaStatus, consultationId, scheduledAt)
        return
      }

      // ── Dismiss: browser closed ────────────────────────────────────────────
      // When Chapa's flow opens an external banking app (CBE Birr, Telebirr…),
      // ASWebAuthenticationSession breaks and returns 'dismiss'. The bank app
      // completes the payment then iOS fires the carehub:// deep link via
      // Linking. We wait up to 4 s for that event before assuming cancellation.
      if (!capturedLinkingUrl) {
        await Promise.race([
          linkingPromise,
          new Promise<void>(res => setTimeout(res, 4000)),
        ])
      }

      if (capturedLinkingUrl) {
        let chapaStatus = 'unknown'
        try {
          const urlObj = new URL(capturedLinkingUrl)
          chapaStatus = urlObj.searchParams.get('status') ?? 'unknown'
        } catch {}
        navigateToReturn(chapaStatus, consultationId, scheduledAt)
        return
      }

      // No deep link. The user may have paid and hit X on the receipt, or may
      // have cancelled without paying. We don't know here, so we hand off to
      // payment-return which polls the DB for up to 60 s and cancels only after
      // confirming the webhook never arrived. The verifying screen also has a
      // manual "I didn't pay" button for users who genuinely cancelled.
      navigateToReturn('unknown', consultationId, scheduledAt)
    } catch (err: any) {
      if (consultationId) {
        const token = await getToken().catch(() => null)
        if (token) {
          getAuthClient(token)
            .from('consultations')
            .update({ status: 'cancelled' })
            .eq('id', consultationId)
            .then(() => {})
        }
      }
      Alert.alert(
        'Payment Failed',
        err?.message ?? 'Something went wrong. Please try again.',
        [{ text: 'OK' }],
      )
    } finally {
      linkingSub.remove()
      setPaying(false)
    }
  }

  const canGoNext = () => {
    if (step === 2 && timing === 'now') return canStartNow
    if (step === 2 && timing === 'schedule') {
      if (days.length === 0) return false
      if (selectedTime === '') return false
      if (bookedTimes.has(selectedTime)) return false
      if (isSlotPast(days[selectedDay]?.value ?? '', selectedTime)) return false
      return true
    }
    return true
  }

  const handleNext = () => {
    if (step === 1) setStep(2)
    else if (step === 2) setStep(3)
    else initiateChapaPayment()
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={paying ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={paying ? undefined : onClose} />
      <Animated.View style={[styles.sheet, { paddingBottom: 12 + insets.bottom, transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Book Consultation</Text>
            <Text style={styles.doctorName}>{doctor.name}</Text>
          </View>
          <Pressable onPress={paying ? undefined : onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </Pressable>
        </View>

        {/* Step indicators */}
        <View style={styles.stepRow}>
          {[1, 2, 3].map(s => (
            <View key={s} style={[styles.stepDot, step >= s && styles.stepDotActive]} />
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.body}>
          {/* ── Step 1: Choose consultation type ── */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>Choose Consultation Type</Text>
              {activeCredit && !creditLoading && (
                <View style={styles.creditBanner}>
                  <Ionicons name="wallet-outline" size={16} color="#059669" />
                  <Text style={styles.creditBannerText}>
                    You have an unused {CONSULT_TYPES.find(t => t.id === activeCredit.type)?.label ?? activeCredit.type} credit —
                    it can only be applied to another {CONSULT_TYPES.find(t => t.id === activeCredit.type)?.label ?? activeCredit.type} consultation.
                  </Text>
                </View>
              )}
              {CONSULT_TYPES.map(type => {
                const locked = Boolean(activeCredit) && type.id !== activeCredit?.type
                return (
                  <Pressable
                    key={type.id}
                    style={[styles.typeCard, consultType === type.id && styles.typeCardSelected, locked && styles.typeCardLocked]}
                    onPress={() => { if (!locked) setConsultType(type.id) }}
                    disabled={locked}
                  >
                    <View style={[styles.typeIconWrap, { backgroundColor: `${type.color}18` }]}>
                      <Ionicons name={locked ? 'lock-closed' : (type.icon as any)} size={locked ? 20 : 26} color={locked ? '#9CA3AF' : type.color} />
                    </View>
                    <View style={styles.typeInfo}>
                      <Text style={[styles.typeLabel, locked && styles.typeLabelLocked]}>{type.label}</Text>
                      <Text style={styles.typePrice}>ETB {getPrice(type.id)}</Text>
                    </View>
                    {!locked && (
                      <View style={[styles.radioOuter, consultType === type.id && styles.radioSelected]}>
                        {consultType === type.id && <View style={styles.radioInner} />}
                      </View>
                    )}
                  </Pressable>
                )
              })}
            </View>
          )}

          {/* ── Step 2: Choose timing ── */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>When do you want to consult?</Text>
              <View style={styles.timingRow}>
                <Pressable
                  style={[
                    styles.timingCard,
                    timing === 'now' && styles.timingCardSelected,
                    !canStartNow && styles.timingCardDisabled,
                  ]}
                  disabled={!canStartNow}
                  onPress={() => setTiming('now')}
                >
                  <Ionicons name="flash" size={22} color={timing === 'now' ? colors.mistWhite : colors.tealGreen} />
                  <Text style={[styles.timingLabel, timing === 'now' && styles.timingLabelSelected]}>On-Demand</Text>
                  <Text style={[styles.timingSub, timing === 'now' && styles.timingSubSelected]}>
                    {!doctor.is_online ? 'Doctor Offline' : doctorBusy ? 'In Another Consultation' : 'Start Now'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.timingCard,
                    timing === 'schedule' && styles.timingCardSelected,
                  ]}
                  onPress={() => setTiming('schedule')}
                >
                  <Ionicons name="calendar" size={22} color={timing === 'schedule' ? colors.mistWhite : colors.careBlue} />
                  <Text style={[styles.timingLabel, timing === 'schedule' && styles.timingLabelSelected]}>Schedule</Text>
                  <Text style={[styles.timingSub, timing === 'schedule' && styles.timingSubSelected]}>
                    Pick a time
                  </Text>
                </Pressable>
              </View>

              {timing === 'schedule' && (
                <>
                  <Text style={styles.pickerLabel}>Select Date</Text>
                  {days.length === 0 ? (
                    <View style={styles.noSlotsWrap}>
                      <Text style={styles.noSlotsText}>No available dates in the next two weeks.</Text>
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
                      {days.map((day, idx) => (
                        <Pressable
                          key={day.value}
                          onPress={() => { setSelectedDay(idx); setSelectedTime('') }}
                          style={[styles.dayChip, selectedDay === idx && styles.dayChipSelected]}
                        >
                          <Text style={[styles.dayText, selectedDay === idx && styles.dayTextSelected]}>
                            {day.label}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}

                  {days.length > 0 && (() => {
                    const slots = getAvailableSlots(doctor?.availability ?? null, days[selectedDay]?.value ?? '')
                    return (
                      <>
                        <Text style={styles.pickerLabel}>Select Time</Text>
                        {slots.length === 0 ? (
                          <View style={styles.noSlotsWrap}>
                            <Text style={styles.noSlotsText}>No time slots available for this day.</Text>
                          </View>
                        ) : (
                          <>
                            <View style={styles.legendRow}>
                              <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchAvailable]} />
                                <Text style={styles.legendText}>Available</Text>
                              </View>
                              <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchBooked]} />
                                <Text style={styles.legendText}>Booked</Text>
                              </View>
                            </View>
                            <View style={styles.timeGrid}>
                              {slots.map(slot => {
                                const isBooked = bookedTimes.has(slot)
                                const isPast = !isBooked && isSlotPast(days[selectedDay]?.value ?? '', slot)
                                return (
                                  <Pressable
                                    key={slot}
                                    onPress={() => setSelectedTime(slot)}
                                    disabled={isBooked || isPast}
                                    style={[
                                      styles.timeChip,
                                      selectedTime === slot && styles.timeChipSelected,
                                      isBooked && styles.timeChipDisabled,
                                      isPast && styles.timeChipPast,
                                    ]}
                                  >
                                    <Text style={[
                                      styles.timeText,
                                      selectedTime === slot && styles.timeTextSelected,
                                      (isBooked || isPast) && styles.timeTextDisabled,
                                    ]}>
                                      {slot}
                                    </Text>
                                  </Pressable>
                                )
                              })}
                            </View>
                          </>
                        )}
                      </>
                    )
                  })()}
                </>
              )}
            </View>
          )}

          {/* ── Step 3: Review & Payment ── */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>Review & Pay</Text>
              <View style={styles.summaryCard}>
                <Row label="Doctor" value={doctor.name} />
                <Row label="Type" value={selectedType.label} />
                <Row label="Timing" value={timing === 'now' ? 'On-Demand (Now)' : `${days[selectedDay].label} at ${selectedTime}`} />
                <View style={styles.summaryDivider} />
                <Row label="Consultation Fee" value={`ETB ${newFee}`} bold />
                {activeCredit && (
                  <>
                    <Row label="Consultation Credit" value={`-ETB ${activeCredit.creditAmount}`} bold />
                  </>
                )}
                <View style={styles.summaryDivider} />
                {activeCredit ? (
                  creditCoversAll
                    ? <Row label="Total Due" value="ETB 0 (Credit Applied)" bold teal />
                    : <Row label="Additional Payment" value={`ETB ${additionalRequired}`} bold teal />
                ) : (
                  <Row label="Total" value={`ETB ${newFee}`} bold teal />
                )}
              </View>

              {/* Credit banner */}
              {activeCredit && !creditLoading && (
                <View style={styles.creditBanner}>
                  <Ionicons name="wallet-outline" size={16} color="#059669" />
                  <Text style={styles.creditBannerText}>
                    {creditCoversAll
                      ? 'Your consultation credit covers the full amount. No payment required.'
                      : `Your ETB ${activeCredit.creditAmount} credit is applied. Pay only ETB ${additionalRequired} via Chapa.`}
                  </Text>
                </View>
              )}

              {/* Chapa payment methods — only when payment needed */}
              {!creditCoversAll && (
                <View style={styles.chapaCard}>
                  <Text style={styles.chapaTitle}>Pay securely with Chapa</Text>
                  <View style={styles.chapaMethodsRow}>
                    {['CBE Birr', 'Telebirr', 'Awash', 'HelloCash'].map(m => (
                      <View key={m} style={styles.chapaMethod}>
                        <Text style={styles.chapaMethodText}>{m}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.chapaNote}>
                    You will be redirected to Chapa to complete your payment. Your booking is confirmed only after successful payment.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* CTA Button */}
        <View style={styles.footer}>
          {step > 1 && (
            <Pressable
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}
              onPress={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              disabled={confirming}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleNext}
            disabled={!canGoNext() || paying}
            style={({ pressed }) => [styles.nextBtnWrap, pressed && { opacity: 0.88 }, (!canGoNext() || paying) && styles.btnDisabled]}
          >
            <LinearGradient
              colors={gradients.interactive}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextBtn}
            >
              {paying ? (
                <ActivityIndicator color={colors.mistWhite} />
              ) : (
                <Text style={styles.nextBtnText}>
                  {step === 3
                    ? creditCoversAll
                      ? 'Confirm Booking (Free with Credit)'
                      : activeCredit
                        ? `Pay ETB ${additionalRequired} with Chapa`
                        : `Pay ETB ${newFee} with Chapa`
                    : 'Continue →'}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  )
}

function Row({ label, value, bold, teal }: { label: string; value: string; bold?: boolean; teal?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryBold, teal && styles.summaryTeal]}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  // paddingBottom is overridden inline with the device safe-area inset added — see JSX.
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingBottom: 12,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.steelGrey,
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  doctorName: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  stepRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginBottom: 4 },
  stepDot: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.cloudGrey,
  },
  stepDotActive: { backgroundColor: colors.tealGreen },
  body: { paddingHorizontal: 20 },
  stepContent: { paddingBottom: 20 },
  stepLabel: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, marginBottom: 16 },

  // Consult type cards
  typeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 14, marginBottom: 10, backgroundColor: colors.mistWhite,
  },
  typeCardSelected: { borderColor: colors.tealGreen, backgroundColor: '#F0FDFB' },
  typeCardLocked: { opacity: 0.5 },
  typeLabelLocked: { color: '#9CA3AF' },
  typeIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  typeInfo: { flex: 1 },
  typeLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  typePrice: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.tealGreen },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.tealGreen },

  // Timing
  timingRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  timingCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 18, alignItems: 'center', gap: 6,
  },
  timingCardSelected: { borderColor: colors.tealGreen, backgroundColor: colors.tealGreen },
  timingCardDisabled: { opacity: 0.4 },
  timingLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  timingLabelSelected: { color: colors.mistWhite },
  timingSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  timingSubSelected: { color: 'rgba(255,255,255,0.8)' },

  // Schedule pickers
  pickerLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 10 },
  dayScroll: { marginBottom: 20 },
  noSlotsWrap: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.cloudGrey, marginBottom: 16 },
  noSlotsText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center' },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    marginRight: 8, backgroundColor: colors.mistWhite,
  },
  dayChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  dayText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  dayTextSelected: { color: colors.mistWhite },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: {
    width: 14, height: 14, borderRadius: 4,
    borderWidth: 1.5,
  },
  legendSwatchAvailable: { borderColor: colors.success, backgroundColor: 'rgba(0,203,83,0.12)' },
  legendSwatchBooked: { borderColor: colors.error, backgroundColor: 'rgba(211,47,47,0.12)' },
  legendText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.success, backgroundColor: 'rgba(0,203,83,0.08)',
  },
  timeChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  // Red tint mirrors legendSwatchBooked so the grid matches the legend;
  // opacity keeps the existing dampened/disabled affordance on top of it.
  timeChipDisabled: { borderColor: colors.error, backgroundColor: 'rgba(211,47,47,0.08)', opacity: 0.7 },
  // Neutral grey (not red) — a past slot isn't "taken by someone else", so it
  // shouldn't read the same as timeChipDisabled.
  timeChipPast: { borderColor: colors.steelGrey, backgroundColor: 'rgba(212,217,225,0.3)', opacity: 0.6 },
  timeText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  timeTextSelected: { color: colors.mistWhite },
  timeTextDisabled: { color: '#9CA3AF' },

  // Summary
  summaryCard: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 16, gap: 12, marginBottom: 14,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  summaryValue: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
  summaryBold: { fontFamily: fonts.bold },
  summaryTeal: { color: colors.tealGreen },
  summaryDivider: { height: 1, backgroundColor: colors.cloudGrey },

  // Credit banner (step 3)
  creditBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 12, padding: 14, marginBottom: 14,
    backgroundColor: 'rgba(5,150,105,0.1)',
    borderWidth: 1, borderColor: 'rgba(5,150,105,0.3)',
  },
  creditBannerText: {
    flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#059669', lineHeight: 18,
  },

  // Chapa payment section
  chapaCard: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 16, gap: 12, marginBottom: 14,
    backgroundColor: '#F0FDFB',
  },
  chapaTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  chapaMethodsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chapaMethod: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: colors.mistWhite, borderWidth: 1, borderColor: colors.steelGrey,
  },
  chapaMethodText: { fontFamily: fonts.medium, fontSize: 12, color: '#374151' },
  chapaNote: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', lineHeight: 18 },

  // Footer
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 },
  backBtn: {
    height: 52, paddingHorizontal: 20, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  nextBtnWrap: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  nextBtn: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  nextBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  btnDisabled: { opacity: 0.5 },
})
