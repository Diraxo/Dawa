import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { formatDoctorName } from '@/lib/nameFormat'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

const PENDING_KEY = 'carehub_pending_consultation'

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  chat:  { icon: 'chatbubble-ellipses', label: 'Chat Consultation',  color: colors.tealGreen },
  phone: { icon: 'call',                label: 'Phone Consultation', color: colors.careBlue },
  video: { icon: 'videocam',            label: 'Video Consultation', color: '#7C3AED' },
}

const ROUTE_MAP: Record<string, string> = {
  chat:  '/(patient)/chat-consultation',
  phone: '/(patient)/phone-consultation',
  video: '/(patient)/video-consultation',
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  waiting_for_doctor: { label: 'Waiting for Doctor', color: colors.warning,   bg: 'rgba(217,119,6,0.12)' },
  accepted:           { label: 'Accepted',           color: colors.tealGreen,  bg: 'rgba(0,191,165,0.12)' },
  in_progress:        { label: 'In Progress',        color: colors.success,    bg: 'rgba(56,161,105,0.12)' },
  pending_payment:    { label: 'Pending Payment',    color: colors.steelGrey,  bg: 'rgba(156,163,175,0.12)' },
}

interface CreditState {
  doctorName:            string
  creditAmount:          number
  creditConsultationId:  string
}

interface DoctorInfo {
  fullName:        string
  photoUrl:        string | null
  specialty:       string
  yearsExperience: number | null
  hospitalName:    string | null
}

export default function WaitingRoomScreen() {
  const router = useRouter()
  const { getToken, userId: clerkUserId } = useAuth()

  const {
    consultationId,
    doctorId,
    doctorName: doctorNameParam,
    consultationType,
  } = useLocalSearchParams<{
    consultationId: string
    doctorId:       string
    doctorName:     string
    consultationType: string
  }>()

  const typeInfo = TYPE_META[consultationType ?? 'chat'] ?? TYPE_META.chat
  const navigated = useRef(false)
  const myUserIdRef = useRef<string | null>(null)
  const [doctorInfo, setDoctorInfo] = useState<DoctorInfo | null>(null)
  const [doctorUserRowId, setDoctorUserRowId] = useState<string | null>(null)
  const [consultStatus, setConsultStatus] = useState<string>('waiting_for_doctor')
  const [creditState, setCreditState] = useState<CreditState | null>(null)
  const [cancelledState, setCancelledState] = useState<CreditState | null>(null)
  const [cancelling, setCancelling] = useState(false)
  // Covers 'missed' (call rang and was never answered), 'ended_abnormally'
  // (dropped mid-connect) and 'call_declined' (patient declined the ring on
  // the call screen) — all reachable from here once the doctor has accepted,
  // and previously unhandled: the screen fell back to its default "Waiting
  // for Doctor" badge forever while Cancel refused with "the doctor has
  // already responded".
  const [callIssueState, setCallIssueState] = useState<{ doctorName: string; reason: string } | null>(null)

  // The waiting room stays active until the doctor accepts/declines or the
  // patient cancels — never a countdown/timeout. There is no server-side
  // auto-expiry of a paid, waiting consultation; this screen only reacts to
  // a real status change (accepted/declined/cancelled).

  // ── Save pending state for session recovery ──────────────────────────────
  useEffect(() => {
    if (!consultationId) return
    AsyncStorage.setItem(PENDING_KEY, JSON.stringify({
      consultationId,
      doctorId,
      doctorName: doctorNameParam ?? '',
      consultationType,
    }))
  }, [consultationId])

  // ── Resolve own internal user id (needed to stamp cancelled_by) ──────────
  useEffect(() => {
    if (!clerkUserId) return
    getToken().then(async (token) => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('users')
        .select('id')
        .eq('clerk_id', clerkUserId)
        .maybeSingle()
      if (data) myUserIdRef.current = data.id
    })
  }, [clerkUserId])

  // ── Fetch doctor info ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!consultationId) return
    supabase
      .from('consultations')
      .select('doctor:doctor_profiles(specialty, years_experience, hospital_name, user:users(id, full_name, profile_photo_url))')
      .eq('id', consultationId)
      .single()
      .then(({ data }) => {
        if (!data) return
        const dp = (data as any).doctor ?? {}
        const u  = dp.user ?? {}
        setDoctorInfo({
          fullName:        u.full_name ?? doctorNameParam ?? 'Doctor',
          photoUrl:        u.profile_photo_url ?? null,
          specialty:       dp.specialty ?? 'General Practice',
          yearsExperience: dp.years_experience ?? null,
          hospitalName:    dp.hospital_name ?? null,
        })
        setDoctorUserRowId(u.id ?? null)
      })
  }, [consultationId])

  // Doctor may edit their name/photo while a patient is sitting in the
  // waiting room — the fetch above only ever runs once, so without this the
  // patient would see stale identity for the whole wait.
  const { name: liveDoctorName, photoUrl: liveDoctorPhotoUrl } = useUserProfileRealtime(
    doctorUserRowId,
    doctorInfo?.fullName,
    doctorInfo?.photoUrl
  )

  // Keep a ref to doctorInfo so the subscription callback always reads the
  // latest value without needing to be recreated when it loads.
  const doctorInfoRef = useRef<DoctorInfo | null>(null)
  useEffect(() => { doctorInfoRef.current = doctorInfo }, [doctorInfo])

  // Doctor's specialty/hospital live on `doctor_profiles`, not `users`, so
  // useUserProfileRealtime (name/photo only) never catches an edit to those
  // fields — the fetch above only ever runs once, so without this the
  // patient would see a stale specialty/hospital for the whole wait.
  useEffect(() => {
    if (!doctorId) return
    const channel = supabase
      .channel(`waiting-room-doctor-profile-${doctorId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorId}` },
        (payload) => {
          const updated = payload.new as any
          setDoctorInfo(prev => prev ? {
            ...prev,
            specialty: updated.specialty ?? prev.specialty,
            hospitalName: updated.hospital_name ?? prev.hospitalName,
            yearsExperience: updated.years_experience ?? prev.yearsExperience,
          } : prev)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [doctorId])

  // ── Realtime subscription: track consultation status ─────────────────────
  useEffect(() => {
    if (!consultationId) return

    // Unique name per mount so React Strict Mode's double-invoke doesn't
    // collide with the async cleanup from the previous subscription.
    const channel = supabase
      .channel(`waiting-room-${consultationId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'consultations',
          filter: `id=eq.${consultationId}`,
        },
        (payload) => {
          const newStatus: string = (payload.new as any)?.status ?? ''
          setConsultStatus(newStatus)

          if (navigated.current) return

          if (newStatus === 'accepted' || newStatus === 'in_progress' || newStatus === 'active') {
            navigated.current = true
            AsyncStorage.removeItem(PENDING_KEY)
            const doctorDisplayName = doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'Doctor'
            router.replace({
              pathname: ROUTE_MAP[consultationType ?? 'chat'] as any,
              params: {
                channelId:        consultationId,
                consultationId,
                doctorId,
                doctorName:       doctorDisplayName,
                doctorPhotoUrl:   doctorInfoRef.current?.photoUrl ?? '',
              },
            })
          } else if (newStatus === 'declined') {
            navigated.current = true
            AsyncStorage.removeItem(PENDING_KEY)
            // Fetch credit details from DB and show credit UI in-place
            supabase
              .from('consultations')
              .select('credit_amount, consultation_credit')
              .eq('id', consultationId)
              .single()
              .then(({ data }) => {
                const amount = Number(data?.credit_amount ?? 0)
                setCreditState({
                  doctorName:           doctorInfo?.fullName ?? doctorNameParam ?? '',
                  creditAmount:         amount,
                  creditConsultationId: consultationId,
                })
              })
          } else if (newStatus === 'cancelled') {
            navigated.current = true
            AsyncStorage.removeItem(PENDING_KEY)
            supabase
              .from('consultations')
              .select('credit_amount, consultation_credit')
              .eq('id', consultationId)
              .single()
              .then(({ data }) => {
                setCancelledState({
                  doctorName:           doctorInfoRef.current?.fullName ?? doctorNameParam ?? '',
                  creditAmount:         Number(data?.credit_amount ?? 0),
                  creditConsultationId: consultationId,
                })
              })
          } else if (newStatus === 'missed' || newStatus === 'call_declined' || newStatus === 'ended_abnormally') {
            navigated.current = true
            AsyncStorage.removeItem(PENDING_KEY)
            setCallIssueState({
              doctorName: doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'the doctor',
              reason: newStatus,
            })
          }
        },
      )
      .subscribe()

    // Poll every 5 s as a guaranteed fallback when Realtime is unreliable
    async function checkNow() {
      if (navigated.current) return
      const { data: pollData } = await supabase
        .from('consultations')
        .select('status, type')
        .eq('id', consultationId)
        .single()
      if (!pollData || navigated.current) return
      setConsultStatus(pollData.status)
      const s = pollData.status
      if (s === 'accepted' || s === 'in_progress' || s === 'active') {
        navigated.current = true
        AsyncStorage.removeItem(PENDING_KEY)
        router.replace({
          pathname: ROUTE_MAP[consultationType ?? 'chat'] as any,
          params: {
            channelId:        consultationId,
            consultationId,
            doctorId,
            doctorName:       doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'Doctor',
            doctorPhotoUrl:   doctorInfoRef.current?.photoUrl ?? '',
          },
        })
      } else if (s === 'declined') {
        navigated.current = true
        AsyncStorage.removeItem(PENDING_KEY)
        supabase
          .from('consultations')
          .select('credit_amount, consultation_credit')
          .eq('id', consultationId)
          .single()
          .then(({ data: cd }) => {
            setCreditState({
              doctorName:           doctorInfoRef.current?.fullName ?? doctorNameParam ?? '',
              creditAmount:         Number(cd?.credit_amount ?? 0),
              creditConsultationId: consultationId,
            })
          })
      } else if (s === 'cancelled') {
        navigated.current = true
        AsyncStorage.removeItem(PENDING_KEY)
        supabase
          .from('consultations')
          .select('credit_amount, consultation_credit')
          .eq('id', consultationId)
          .single()
          .then(({ data: cd }) => {
            setCancelledState({
              doctorName:           doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'the doctor',
              creditAmount:         Number(cd?.credit_amount ?? 0),
              creditConsultationId: consultationId,
            })
          })
      } else if (s === 'missed' || s === 'call_declined' || s === 'ended_abnormally') {
        navigated.current = true
        AsyncStorage.removeItem(PENDING_KEY)
        setCallIssueState({
          doctorName: doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'the doctor',
          reason: s,
        })
      }
    }

    // Run immediately on mount — catches the case where the doctor accepted
    // while the Realtime subscription was still connecting.
    checkNow()
    const pollInterval = setInterval(checkNow, 1500)

    return () => {
      clearInterval(pollInterval)
      supabase.removeChannel(channel)
    }
  }, [consultationId])

  // ── Cancel handler ───────────────────────────────────────────────────────
  // Blocklist, not allowlist: cancellable unless the doctor has genuinely
  // already engaged (accepted/in_progress/active). An allowlist silently
  // broke every time a new terminal status was introduced elsewhere (missed,
  // ended_abnormally, call_declined, ...) — those fell through to the
  // default "Waiting for Doctor" badge while Cancel refused with "the doctor
  // has already responded", stranding the patient here with no way out.
  const ALREADY_ENGAGED_STATUSES = new Set(['accepted', 'in_progress', 'active'])
  const handleCancel = () => {
    if (cancelling || navigated.current) return
    if (ALREADY_ENGAGED_STATUSES.has(consultStatus)) {
      Alert.alert('Unable to Cancel', 'This request can no longer be cancelled because the doctor has already responded.')
      return
    }
    Alert.alert('Cancel Request', 'Are you sure you want to cancel your consultation request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true)
          try {
            const token = await getToken()
            if (!token || !consultationId) throw new Error('Not authenticated')
            const { data, error } = await getAuthClient(token)
              .from('consultations')
              .update({ status: 'cancelled', cancelled_by: myUserIdRef.current })
              .eq('id', consultationId)
              .select('credit_amount, consultation_credit')
              .single()
            if (error) throw error
            // Set navigated only now that the update is confirmed — the
            // realtime/poll handlers guard on navigated.current, so flipping
            // it earlier (before the update landed) would make them ignore
            // the resulting 'cancelled' status and leave the screen stuck.
            navigated.current = true
            await AsyncStorage.removeItem(PENDING_KEY)
            setCancelledState({
              doctorName:           doctorInfoRef.current?.fullName ?? doctorNameParam ?? 'the doctor',
              creditAmount:         Number(data?.credit_amount ?? 0),
              creditConsultationId: consultationId,
            })
          } catch {
            Alert.alert('Cancellation Failed', 'Could not cancel your request. Please check your connection and try again.')
          } finally {
            setCancelling(false)
          }
        },
      },
    ])
  }

  // ── Call rang but never connected (missed / declined / dropped) ────────────
  if (callIssueState) {
    const issueCopy =
      callIssueState.reason === 'call_declined' ? 'You declined the call.' :
      callIssueState.reason === 'ended_abnormally' ? 'The call was disconnected before it could connect.' :
      `You didn't answer in time when ${formatDoctorName(callIssueState.doctorName)} called.`
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.creditIconWrap}>
            <Ionicons name="time-outline" size={64} color={colors.warning} />
          </View>
          <Text style={styles.creditTitle}>Call Not Connected</Text>
          <Text style={styles.creditSub}>{issueCopy}</Text>
          <Pressable
            style={({ pressed }) => [styles.creditBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace('/(patient)/(tabs)/doctors' as any)}
          >
            <Ionicons name="search" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Choose Another Doctor</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.creditBtn, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.steelGrey, marginTop: 12 }, pressed && { opacity: 0.75 }]}
            onPress={() => router.replace({ pathname: '/(patient)/doctor-profile' as any, params: { id: doctorId, autoBook: '1', consultationType } })}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Try Again</Text>
          </Pressable>
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Patient (or admin) cancelled the request — never conflated with the
  // "doctor declined" wording below ────────────────────────────────────────
  if (cancelledState) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.creditIconWrap}>
            <Ionicons name="close-circle-outline" size={64} color={colors.steelGrey} />
          </View>

          <Text style={styles.creditTitle}>Request Cancelled</Text>
          <Text style={styles.creditSub}>
            You cancelled your consultation request with {formatDoctorName(cancelledState.doctorName)}.
          </Text>

          {cancelledState.creditAmount > 0 && (
            <View style={styles.creditCard}>
              <Ionicons name="wallet-outline" size={22} color={colors.tealGreen} />
              <View style={styles.creditCardText}>
                <Text style={styles.creditCardLabel}>Consultation Credit Preserved</Text>
                <Text style={styles.creditCardAmount}>ETB {cancelledState.creditAmount.toFixed(2)}</Text>
              </View>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.creditBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace({ pathname: '/(patient)/doctor-profile' as any, params: { id: doctorId, autoBook: '1', consultationType } })}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Reschedule</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.creditBtn, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.steelGrey, marginTop: 12 }, pressed && { opacity: 0.75 }]}
            onPress={() => router.replace('/(patient)/(tabs)/doctors' as any)}
          >
            <Ionicons name="search" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Choose Another Doctor</Text>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Consultation credit screen (doctor declined a paid consultation) ────────
  if (creditState) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.creditIconWrap}>
            <Ionicons name="close-circle" size={64} color={colors.error} />
          </View>

          <Text style={styles.creditTitle}>Consultation Unavailable</Text>
          <Text style={styles.creditSub}>
            {formatDoctorName(creditState.doctorName)} is unavailable.
          </Text>

          <View style={styles.creditCard}>
            <Ionicons name="wallet-outline" size={22} color={colors.tealGreen} />
            <View style={styles.creditCardText}>
              <Text style={styles.creditCardLabel}>Consultation Credit Available</Text>
              <Text style={styles.creditCardAmount}>ETB {creditState.creditAmount.toFixed(2)}</Text>
            </View>
          </View>

          <Text style={styles.creditNote}>
            Your consultation credit has been preserved. No additional payment required when you book with another doctor at the same or lower fee.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.creditBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace('/(patient)/(tabs)/doctors' as any)}
          >
            <Ionicons name="search" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Choose Another Doctor</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.creditBtn, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.steelGrey, marginTop: 12 }, pressed && { opacity: 0.75 }]}
            onPress={() => router.replace({ pathname: '/(patient)/doctor-profile' as any, params: { id: doctorId, autoBook: '1', consultationType } })}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.mistWhite} />
            <Text style={styles.creditBtnText}>Reschedule</Text>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    )
  }

  const displayName   = formatDoctorName(liveDoctorName ?? doctorInfo?.fullName ?? doctorNameParam, 'Doctor')
  const displayPhotoUrl = liveDoctorPhotoUrl ?? doctorInfo?.photoUrl ?? null
  const statusMeta    = STATUS_LABELS[consultStatus] ?? STATUS_LABELS.waiting_for_doctor
  const estimatedTime = '5 – 10 minutes'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top badge: consultation type ── */}
        <View style={styles.typeRow}>
          <View style={[styles.typeBadge, { backgroundColor: `${typeInfo.color}18` }]}>
            <Ionicons name={typeInfo.icon as any} size={15} color={typeInfo.color} />
            <Text style={[styles.typeBadgeText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
          </View>
        </View>

        {/* ── Payment success badge ── */}
        <View style={styles.paymentBadge}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.paymentBadgeText}>Payment Successful</Text>
        </View>

        {/* ── Main message ── */}
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>
            Your payment was successful. Your consultation request has been sent to the doctor. Please wait while the doctor reviews your request.
          </Text>
        </View>

        {/* ── Consultation status ── */}
        <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
          <Text style={[styles.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
        </View>

        {/* ── Doctor profile card ── */}
        <View style={styles.doctorCard}>
          <Text style={styles.sectionLabel}>Your Doctor</Text>

          <View style={styles.doctorRow}>
            {displayPhotoUrl ? (
              <Image source={{ uri: displayPhotoUrl }} style={styles.doctorPhoto} />
            ) : (
              <View style={styles.doctorPhotoPlaceholder}>
                <Ionicons name="person" size={36} color={colors.steelGrey} />
              </View>
            )}

            <View style={styles.doctorMeta}>
              <Text style={styles.doctorName}>{displayName}</Text>
              {doctorInfo?.specialty ? (
                <View style={styles.doctorTagRow}>
                  <Ionicons name="medical-outline" size={13} color={colors.tealGreen} />
                  <Text style={styles.doctorTag}>{doctorInfo.specialty}</Text>
                </View>
              ) : null}
              {doctorInfo?.yearsExperience != null ? (
                <View style={styles.doctorTagRow}>
                  <Ionicons name="time-outline" size={13} color={colors.careBlue} />
                  <Text style={styles.doctorTag}>{doctorInfo.yearsExperience} yrs experience</Text>
                </View>
              ) : null}
              {doctorInfo?.hospitalName ? (
                <View style={styles.doctorTagRow}>
                  <Ionicons name="business-outline" size={13} color="#6B7280" />
                  <Text style={[styles.doctorTag, { color: '#6B7280' }]}>{doctorInfo.hospitalName}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Consultation details card ── */}
        <View style={styles.detailsCard}>
          <Text style={styles.sectionLabel}>Consultation Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name={typeInfo.icon as any} size={16} color={typeInfo.color} />
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={[styles.detailValue, { color: typeInfo.color }]}>{typeInfo.label}</Text>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={16} color="#6B7280" />
            <Text style={styles.detailLabel}>Est. Response</Text>
            <Text style={styles.detailValue}>{estimatedTime}</Text>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <Ionicons name="card-outline" size={16} color={colors.success} />
            <Text style={styles.detailLabel}>Payment</Text>
            <Text style={[styles.detailValue, { color: colors.success }]}>Confirmed</Text>
          </View>
        </View>

        {/* ── Info note ── */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.45)" />
          <Text style={styles.infoNoteText}>
            You can safely close the app and return later. We'll notify you as soon as the doctor responds.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ── Cancel button ── */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.75 }, cancelling && styles.cancelBtnDisabled]}
          onPress={handleCancel}
          disabled={cancelling}
        >
          {cancelling ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Ionicons name="close-circle-outline" size={20} color={colors.error} />
          )}
          <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel Request'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#070E27' },
  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  typeRow:   { alignItems: 'center', marginBottom: 16 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  paymentBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(56,161,105,0.15)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(56,161,105,0.3)',
  },
  paymentBadgeText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.success },

  messageCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  messageText: {
    fontFamily: fonts.regular, fontSize: 14,
    color: 'rgba(255,255,255,0.75)', lineHeight: 22, textAlign: 'center',
  },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 10, marginBottom: 20,
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: fonts.semiBold, fontSize: 14 },

  doctorCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    ...shadow('#000', 0, 4, 12, 0.25, 6),
  },
  sectionLabel: {
    fontFamily: fonts.semiBold, fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 12,
  },
  doctorRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  doctorPhoto: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: colors.tealGreen,
  },
  doctorPhotoPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.tealGreen,
  },
  doctorMeta:    { flex: 1, gap: 6 },
  doctorName:    { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite },
  doctorTagRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  doctorTag:     { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.65)' },

  detailsCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  detailRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  detailLabel:   { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  detailValue:   { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },

  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  infoNoteText: {
    flex: 1, fontFamily: fonts.regular, fontSize: 12,
    color: 'rgba(255,255,255,0.4)', lineHeight: 18,
  },

  footer:    { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.error,
    backgroundColor: 'rgba(211,47,47,0.1)',
  },
  cancelBtnDisabled: { opacity: 0.6 },
  cancelText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.error },

  // ── Credit screen ────────────────────────────────────────────────────────
  creditIconWrap: { alignItems: 'center', marginTop: 48, marginBottom: 20 },
  creditTitle:    { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite, textAlign: 'center', marginBottom: 8 },
  creditSub:      { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 24, paddingHorizontal: 8 },

  creditCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(0,191,165,0.12)',
    borderRadius: 16, padding: 18, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(0,191,165,0.3)',
  },
  creditCardText:   { flex: 1 },
  creditCardLabel:  { fontFamily: fonts.semiBold, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  creditCardAmount: { fontFamily: fonts.bold, fontSize: 22, color: colors.tealGreen },

  creditNote: {
    fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)',
    textAlign: 'center', lineHeight: 20, marginBottom: 28,
  },

  creditBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, borderRadius: 16,
    backgroundColor: colors.tealGreen,
  },
  creditBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
