import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ConsultationActionButtons } from '@/components/ui/ConsultationActionButtons'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { shadow } from '@/lib/shadow'
import { createConsultationChannel } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { markNotificationsReadForConsultation } from '@/lib/notificationCenter'
import { stopIncomingRequestRing } from '@/hooks/useIncomingConsultationAlert'
import { useAuthStore } from '@/store/authStore'
import { useActiveIncomingRequestStore } from '@/store/activeIncomingRequestStore'
import { ghostDebug, logger } from '@/lib/logger'
import { useTranslation } from 'react-i18next'

const DECLINE_REASONS = ['Currently busy', 'Wrong specialty', 'Technical issue', 'Other']

export default function IncomingRequestScreen() {
  const { t } = useTranslation()

  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { userId } = useAuthStore()
  const { photoUrl: doctorPhotoUrl } = useOwnProfilePhoto()

  const {
    patientName,
    patientId,
    patientClerkId,
    patientPhotoUrl: patientPhotoUrlParam,
    consultationType,
    consultationId,
  } = useLocalSearchParams<{
    patientName:       string
    patientId?:        string
    patientClerkId?:   string
    patientPhotoUrl?:  string
    consultationType:  string
    consultationId?:   string
    waitingStartedAt?: string // kept for backwards compat, no longer used
  }>()

  useEffect(() => {
    logger.log('[IncomingRequestScreen] Mounted — final pipeline stage reached, consultationId=', consultationId)
    ghostDebug('[incoming-consultation] IncomingRequestScreen mounted', { consultationId, consultationType })
    return () => { ghostDebug('[incoming-consultation] IncomingRequestScreen unmounted', { consultationId }) }
  }, [consultationId])

  // The doctor may have been alerted via useIncomingConsultationAlert.ts's
  // continuous ring (vibration + a looping Notifee notification) right
  // before landing here, or via the FCM-triggered background/foreground
  // ring (index.js / lib/voipPush.ts) — reaching this screen at all means
  // the doctor has already seen the request, so stop ringing immediately
  // rather than leaving the phone buzzing/looping through however long they
  // take to actually tap Accept/Decline.
  useEffect(() => {
    if (consultationId) stopIncomingRequestRing(consultationId)
  }, [consultationId])

  // Auto-clear: reaching this screen directly (Home tab tap, realtime
  // detection) rather than by tapping the "Incoming Consultation"
  // notification still means it's been handled — mark it read so it
  // doesn't sit stale in the tray/badge/Notification Center.
  useEffect(() => {
    if (!consultationId || !userId) return
    markNotificationsReadForConsultation(supabase, userId, consultationId)
  }, [consultationId, userId])

  // Photo may arrive via route param (push-notification path); fall back to
  // a DB fetch when it doesn't (e.g. direct deep-link with a stale param set).
  const [patientInitialPhotoUrl, setPatientInitialPhotoUrl] = useState<string | null>(patientPhotoUrlParam ?? null)
  useEffect(() => {
    if (patientPhotoUrlParam || !consultationId) return
    let cancelled = false
    supabase
      .from('consultations')
      .select('patient:users!patient_id(profile_photo_url)')
      .eq('id', consultationId)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        setPatientInitialPhotoUrl((data as any)?.patient?.profile_photo_url ?? null)
      })
    return () => { cancelled = true }
  }, [consultationId, patientPhotoUrlParam])
  // Kept live via Realtime so a rename/photo change while this request is
  // ringing still shows the patient's current identity on Accept.
  const { name: livePatientName, photoUrl: patientPhotoUrl } = useUserProfileRealtime(
    patientId ?? null,
    patientName ?? null,
    patientInitialPhotoUrl
  )
  const effectivePatientName = livePatientName ?? patientName ?? 'Patient'

  const TYPE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
    chat:  { icon: 'chatbubble-ellipses', label: t('chatConsultation'),  color: colors.tealGreen, bg: 'rgba(0,191,165,0.15)' },
    phone: { icon: 'call',                label: t('phoneConsultation'), color: colors.careBlue,  bg: 'rgba(26,69,152,0.15)' },
    video: { icon: 'videocam',            label: t('videoConsultation'), color: '#7C3AED',         bg: 'rgba(124,58,237,0.15)' },
  }

  const meta = TYPE_META[consultationType ?? 'chat'] ?? TYPE_META.chat
  const [responded, setResponded] = useState(false)
  const navigatedRef = useRef(false)

  // This full screen is the single source of truth for presenting an
  // incoming request — mark it "shown" for as long as it's mounted so other
  // surfaces (Home tab's own Realtime/poll detection) skip re-triggering a
  // second dialog for the same consultation while this one is already up.
  useEffect(() => {
    if (!consultationId) return
    useActiveIncomingRequestStore.getState().setShownRequestId(consultationId)
    return () => {
      if (useActiveIncomingRequestStore.getState().shownRequestId === consultationId) {
        useActiveIncomingRequestStore.getState().setShownRequestId(null)
      }
    }
  }, [consultationId])

  // ── Freshness check: this screen can be reached from a queued/duplicate
  // push notification after the request was already handled elsewhere
  // (another device/session, or the patient cancelling first). Verify the
  // consultation is still actually waiting before showing Accept/Decline —
  // otherwise the doctor sees a stale dialog and a second Accept tap is a
  // no-op at best, a duplicate Stream-channel/DB-write race at worst.
  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('consultations')
        .select('status, type')
        .eq('id', consultationId)
        .single()
      if (cancelled || navigatedRef.current || !data) return
      ghostDebug('[incoming-consultation] freshness check', { consultationId, status: data.status })
      if (data.status === 'waiting_for_doctor') return // still fresh — show the UI normally

      navigatedRef.current = true
      setResponded(true)
      if (data.status === 'accepted' || data.status === 'in_progress') {
        // Already accepted (e.g. from the home-screen modal) — join the
        // live consultation directly instead of showing a stale Accept screen.
        const route =
          (data.type ?? consultationType) === 'phone'
            ? '/(doctor)/phone-consultation'
            : (data.type ?? consultationType) === 'video'
              ? '/(doctor)/video-consultation'
              : '/(doctor)/chat-consultation'
        router.replace({ pathname: route as any, params: { patientName: patientName ?? 'Patient', patientId: patientId ?? '', consultationId, channelId: consultationId } })
      } else {
        // Already declined/cancelled/missed elsewhere — just leave.
        router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/home' as never)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  // ── Realtime: dismiss if patient cancels before doctor responds ──────────
  // Deliberately keyed only on consultationId (not `responded`, which is
  // always set together with navigatedRef.current — see accept/decline/
  // freshness-check above) so the channel isn't torn down and recreated on
  // every response. That churn matters because this screen can be frozen
  // (native-stack keeps it mounted underneath chat/phone/video-consultation
  // after Accept) and later reconnected without React re-running the
  // cleanup first, which previously raced supabase-js's per-topic channel
  // cache and threw "cannot add postgres_changes callbacks after
  // subscribe()" on the stale, already-subscribed channel. Explicitly
  // removing any same-topic leftover before creating a new one closes that
  // race regardless of cause.
  useEffect(() => {
    if (!consultationId) return
    const topic = `incoming-request-${consultationId}`
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
    if (stale) supabase.removeChannel(stale)
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` },
        (payload) => {
          const status: string = (payload.new as any)?.status ?? ''
          ghostDebug('[realtime] incoming-request channel UPDATE', { consultationId, status, navigatedAlready: navigatedRef.current })
          if (navigatedRef.current) return
          if (status === 'cancelled') {
            navigatedRef.current = true
            setResponded(true)
            Alert.alert(
              t('requestCancelled'),
              t('patientCancelledRequest'),
              [{ text: t('ok'), onPress: () => router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/home' as never) }],
            )
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [consultationId])

  // Writes status:'accepted', retrying a couple of times on failure —
  // without this, a transient network blip or a rejected write (e.g. a
  // trigger exception) silently strands the patient on "Waiting for Doctor"
  // forever while the doctor is already sitting on the call screen unaware
  // anything went wrong. Treats "0 rows matched" as success if some other
  // path (a race with another device/tab) already moved the row past
  // 'waiting_for_doctor'.
  const writeAccepted = async (id: string): Promise<'ok' | 'busy' | 'failed'> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const token = await getToken()
      if (token) {
        const client = getAuthClient(token)
        const { data, error } = await client
          .from('consultations')
          .update({ status: 'accepted', started_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'waiting_for_doctor')
          .select('id')
        if (!error && data && data.length > 0) return 'ok'
        if (!error) {
          const { data: row } = await client.from('consultations').select('status').eq('id', id).single()
          if (row?.status === 'accepted' || row?.status === 'in_progress') return 'ok'
        }
        // DOCTOR_BUSY means the doctor already has another accepted/in_progress
        // consultation (e.g. a scheduled appointment came due while they're on
        // an on-demand call) — a business-rule rejection, not a transient
        // failure, so retrying won't help; bail out immediately.
        if (error?.message?.includes('DOCTOR_BUSY')) return 'busy'
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500))
    }
    return 'failed'
  }

  const alertAcceptFailed = (id: string, name: string) => {
    Alert.alert(
      'Connection Issue',
      `We couldn't confirm the consultation with ${name}. They may still be waiting — retry now?`,
      [
        { text: 'Retry', onPress: async () => { const result = await writeAccepted(id); if (result === 'busy') alertAcceptBusy(); else if (result !== 'ok') alertAcceptFailed(id, name) } },
        { text: 'Dismiss', style: 'cancel' },
      ],
    )
  }

  const alertAcceptBusy = () => {
    Alert.alert(
      'Already In a Consultation',
      "You're currently in another consultation. This request is still waiting — accept it once you're free.",
      [
        {
          text: 'OK',
          onPress: () => {
            router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/home' as never)
          },
        },
      ],
    )
  }

  // Writes status:'declined', retrying a couple of times on failure — mirrors
  // writeAccepted below. Without this, a transient network blip or a
  // rejected write silently leaves the row at 'waiting_for_doctor' forever
  // while the doctor has already navigated away believing they declined.
  // Treats "0 rows matched" as success if some other path (patient
  // cancelled, another device already responded) already moved the row past
  // 'waiting_for_doctor'.
  const writeDeclined = async (id: string, reason: string): Promise<'ok' | 'failed'> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const token = await getToken()
      if (token) {
        const client = getAuthClient(token)
        const { data: me } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', userId ?? user?.id ?? '')
          .maybeSingle()
        const { data, error } = await client
          .from('consultations')
          .update({
            status: 'declined',
            decline_reason: reason,
            declined_by: me?.id ?? null,
            declined_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('status', 'waiting_for_doctor')
          .select('id')
        if (!error && data && data.length > 0) return 'ok'
        if (!error) {
          const { data: row } = await client.from('consultations').select('status').eq('id', id).single()
          if (row?.status !== 'waiting_for_doctor') return 'ok'
        }
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500))
    }
    return 'failed'
  }

  const alertDeclineFailed = (id: string, reason: string, name: string) => {
    Alert.alert(
      'Connection Issue',
      `We couldn't confirm declining the request from ${name}. Retry now?`,
      [
        { text: 'Retry', onPress: async () => { const result = await writeDeclined(id, reason); if (result !== 'ok') alertDeclineFailed(id, reason, name) } },
        { text: 'Dismiss', style: 'cancel' },
      ],
    )
  }

  const declineWithReason = async (reason: string) => {
    if (navigatedRef.current || !consultationId) return
    navigatedRef.current = true
    setResponded(true)
    router.canGoBack()
      ? router.back()
      : router.replace('/(doctor)/(tabs)/home' as never)

    const result = await writeDeclined(consultationId, reason)
    if (result !== 'ok') alertDeclineFailed(consultationId, reason, effectivePatientName)
  }

  const handleDecline = () => {
    Alert.alert(
      t('declineRequest'),
      'Why are you declining?',
      [
        { text: t('cancel'), style: 'cancel' },
        ...DECLINE_REASONS.map((reason) => ({
          text: reason,
          style: reason === 'Other' ? ('destructive' as const) : ('default' as const),
          onPress: () => declineWithReason(reason),
        })),
      ],
    )
  }

  const handleAccept = async () => {
    if (!consultationId) {
      Alert.alert('Error', 'No consultation ID found. Please try again.')
      return
    }
    if (navigatedRef.current) return
    ghostDebug('[consultation-acceptance] handleAccept called', { consultationId, consultationType })

    // Disable the buttons immediately on tap — before any await — so a
    // double-tap can never start two concurrent accept flows (which would
    // both create a Stream channel and both write status: 'accepted').
    navigatedRef.current = true
    setResponded(true)

    // Navigate immediately — never make the doctor wait on this screen for
    // a payment check, Stream channel creation, or DB round-trip. The
    // destination screen shows its own connecting/loading state while
    // everything below happens in the background.
    const params = {
      patientName:    patientName ?? 'Patient',
      patientId:      patientId ?? '',
      consultationId,
      channelId:      consultationId,
    }
    const route =
      consultationType === 'phone'
        ? '/(doctor)/phone-consultation'
        : consultationType === 'video'
          ? '/(doctor)/video-consultation'
          : '/(doctor)/chat-consultation'

    router.replace({ pathname: route as any, params })

    ;(async () => {
      const token = await getToken()

      // Payment should already be confirmed by the time a request reaches
      // 'waiting_for_doctor' (payment-return only flips status after
      // payment_status:'paid'), but re-verify in the background as a safety
      // net — decline rather than leave an unpaid consultation accepted.
      try {
        if (token) {
          const { data: chk } = await getAuthClient(token)
            .from('consultations')
            .select('payment_status')
            .eq('id', consultationId)
            .single()
          if (chk?.payment_status !== 'paid') {
            await getAuthClient(token)
              .from('consultations')
              .update({ status: 'declined', decline_reason: 'Payment not confirmed' })
              .eq('id', consultationId)
            return
          }
        }
      } catch {
        // proceed on check failure — don't strand an otherwise-valid consultation
      }

      // Create the Stream channel and write status concurrently — the call
      // screens lazily create/join the channel via watch({members}) if it
      // doesn't exist yet, so the patient's redirect no longer has to wait
      // on the Stream API round-trip. Stream user IDs are Clerk IDs — never
      // fall back to Supabase UUIDs.
      const doctorUserId = userId ?? user?.id ?? ''
      const channelCreate = (async () => {
        try {
          // Some navigation paths into this screen (the consultations list,
          // active-consultation recovery on relaunch) don't carry the
          // patientClerkId route param — fall back to a DB lookup rather
          // than silently skipping channel creation and leaning on the
          // call screens' self-heal watch({members}), which can race with
          // this write and trip Stream's "duplicate members" check.
          let resolvedPatientClerkId = patientClerkId
          if (!resolvedPatientClerkId) {
            const { data } = await supabase
              .from('consultations')
              .select('patient:users!patient_id(clerk_id)')
              .eq('id', consultationId)
              .single()
            resolvedPatientClerkId = (data as any)?.patient?.clerk_id ?? undefined
          }
          if (!resolvedPatientClerkId) {
            logger.error('[Stream] patientClerkId missing — channel not created for consultation:', consultationId)
          } else if (doctorUserId) {
            await Promise.race([
              createConsultationChannel(consultationId, resolvedPatientClerkId, doctorUserId, {
                doctorName:     user?.fullName ?? user?.firstName ?? 'Doctor',
                doctorSubtitle: '',
                doctorPhotoUrl: doctorPhotoUrl ?? user?.imageUrl ?? null,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('stream channel create timeout')), 5000)),
            ])
          }
        } catch {
          // channel might already exist, or timed out — safe either way,
          // the call screen's watch({members}) will create/join lazily
        }
      })()

      const [, result] = await Promise.all([channelCreate, writeAccepted(consultationId)])
      ghostDebug('[consultation-acceptance] writeAccepted result', { consultationId, result })
      if (result === 'busy') alertAcceptBusy()
      else if (result !== 'ok') alertAcceptFailed(consultationId, patientName ?? 'Patient')
    })()
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top badge */}
      <View style={styles.topRow}>
        <View style={[styles.typeBadge, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon as any} size={16} color={meta.color} />
          <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        <Text style={styles.incomingLabel}>{t('incomingRequest')}</Text>

        <View style={styles.avatarCircle}>
          {patientPhotoUrl ? (
            <Image source={{ uri: patientPhotoUrl }} style={styles.avatarCircleImage} />
          ) : (
            <Ionicons name="person" size={56} color="rgba(255,255,255,0.5)" />
          )}
        </View>

        <Text style={styles.patientName}>{effectivePatientName}</Text>
        <Text style={styles.patientSub}>
          {t('wantsToStartA')} {meta.label.toLowerCase()}
        </Text>

        {/* Payment confirmed badge */}
        <View style={styles.paymentBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.paymentBadgeText}>Payment Confirmed</Text>
        </View>

        {/* Consultation info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={15} color="rgba(255,255,255,0.5)" />
            <Text style={styles.infoLabel}>Patient</Text>
            <Text style={styles.infoValue}>{effectivePatientName}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name={meta.icon as any} size={15} color={meta.color} />
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={[styles.infoValue, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={15} color={colors.success} />
            <Text style={styles.infoLabel}>Payment</Text>
            <Text style={[styles.infoValue, { color: colors.success }]}>Paid</Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <ConsultationActionButtons
          onDecline={handleDecline}
          onAccept={handleAccept}
          declineLabel={t('decline')}
          acceptLabel={t('accept')}
          disabled={responded}
          size={100}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },

  topRow: { alignItems: 'center', paddingTop: 20 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },

  incomingLabel: {
    fontFamily: fonts.medium, fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },

  avatarCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
    overflow: 'hidden',
    ...shadow(colors.tealGreen, 0, 0, 20, 0.4, 10),
  },
  avatarCircleImage: { width: '100%', height: '100%', borderRadius: 60 },

  patientName: {
    fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite,
    textAlign: 'center',
  },
  patientSub: {
    fontFamily: fonts.regular, fontSize: 14,
    color: 'rgba(255,255,255,0.6)', textAlign: 'center',
  },

  paymentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(56,161,105,0.15)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(56,161,105,0.3)',
  },
  paymentBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.success },

  infoCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  infoRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  infoLabel:   { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  infoValue:   { fontFamily: fonts.semiBold, fontSize: 13, color: colors.mistWhite },
  infoDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 20, paddingHorizontal: 32, paddingBottom: 40,
  },
})
