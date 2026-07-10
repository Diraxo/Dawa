import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { IncomingRequestModal } from '@/components/doctor/IncomingRequestModal'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorOnlineToggle } from '@/hooks/useDoctorOnlineToggle'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { shadow } from '@/lib/shadow'
import { createConsultationChannel } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { type IncomingRequest, useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

const CONSULTATION_ICONS: Record<'chat' | 'phone' | 'video', keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam',
}

interface ScheduleItem {
  id: string; patientName: string; time: string; type: 'chat' | 'phone' | 'video'
}

function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function DoctorHomeScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { user } = useUser()
  const { getToken } = useAuth()
  const { userId } = useAuthStore()
  const { incomingRequest, setIncomingRequest, doctorStatus } = useDoctorStore()
  const { photoUrl: doctorPhotoUrl } = useOwnProfilePhoto()

  const rawFirstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'Doctor'
  const firstName = rawFirstName.replace(/^Dr\.?\s*/i, '').trim() || 'Doctor'

  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [stats, setStats] = useState({ totalConsultations: 0, completedToday: 0, earnings: 0, rating: 0 })
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const [doctorUserRowId, setDoctorUserRowId] = useState<string | null>(null)
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const { isOnline, setIsOnline, toggling: togglingOnline, toggle: toggleOnline } = useDoctorOnlineToggle(doctorProfileId, { resyncOnForeground: true })

  // Re-run whenever a consultation change comes in over Realtime (see the
  // subscription below) so a newly-paid scheduled booking, or one that's
  // been rescheduled in/out of today, shows up without a manual refresh.
  const loadTodaySchedule = async (client: ReturnType<typeof getAuthClient>) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    const { data } = await client
      .from('consultations')
      .select(`id, type, scheduled_at, patient:users!consultations_patient_id_fkey(full_name)`)
      .gte('scheduled_at', today.toISOString())
      .lt('scheduled_at', tomorrow.toISOString())
      .in('status', ['pending', 'active', 'waiting_for_doctor', 'accepted', 'in_progress', 'scheduled'])
      .order('scheduled_at', { ascending: true })

    if (data) {
      setSchedule(data.map((r: any) => ({
        id: r.id,
        patientName: (r.patient as any)?.full_name ?? 'Patient',
        time: new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        type: r.type ?? 'chat',
      })))
    }
  }

  // ── Load doctor profile ID + today's data ─────────────────────────────────
  useEffect(() => {
    getToken().then(async token => {
      if (!token) return
      const client = getAuthClient(token)
      const today = new Date(); today.setHours(0, 0, 0, 0)

      const [profileRes, todayStatsRes, allEarningsRes] = await Promise.all([
        client.from('doctor_profiles').select('id, user_id, rating_average, total_consultations, is_online').single(),
        client.from('consultations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('ended_at', today.toISOString()),
        // Lifetime total, not today-scoped — matches the website's "Total
        // Earnings" card (carehub-web/app/doctor/page.tsx), which this
        // screen's stat is meant to mirror.
        client.from('consultations')
          .select('doctor_amount')
          .eq('status', 'completed'),
      ])

      if (profileRes.data) {
        const p = profileRes.data as any
        const profileId: string = p.id
        setDoctorProfileId(profileId)
        setDoctorUserRowId(p.user_id ?? null)
        setIsOnline(p.is_online ?? false)
        const rating = Number(p.rating_average ?? 0)
        const completedToday = todayStatsRes.count ?? 0
        const totalConsultations = p.total_consultations ?? 0
        const earnings = (allEarningsRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.doctor_amount) || 0), 0)
        setStats({ totalConsultations, completedToday, earnings, rating })

        // Show incoming request modal for any consultation already waiting
        // when the doctor opens the screen (Realtime only catches future updates)
        await checkForWaitingRequest(profileId, token)
        await loadTodaySchedule(client)
      }
    })
  }, [])

  // ── Show incoming request only once payment is confirmed, and only while
  // the doctor is NOT already busy in another consultation ─────────────────
  // "Busy" (accepted/in_progress) is re-checked on every call — a scheduled
  // booking can activate mid-session, and the doctor must not be interrupted
  // until their current consultation ends (matches web's IncomingRequestOverlay).
  const shownConsultationIds = useRef(new Set<string>())

  const checkForWaitingRequest = async (profileId: string, token: string) => {
    const client = getAuthClient(token)

    const { data: busy } = await client.rpc('is_doctor_busy', { p_doctor_id: profileId })
    if (busy) return

    if (useDoctorStore.getState().incomingRequest) return

    const { data: waiting } = await client
      .from('consultations')
      .select('id, type, patient_id, patient_amount, waiting_started_at')
      .eq('doctor_id', profileId)
      .eq('status', 'waiting_for_doctor')
      .eq('payment_status', 'paid')
      .order('waiting_started_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!waiting) return
    // Deduplicate — this can be called repeatedly (poll + Realtime) for the same row
    if (shownConsultationIds.current.has(waiting.id)) return
    shownConsultationIds.current.add(waiting.id)

    const [patientData, patientProfile] = await Promise.all([
      supabase.from('users').select('full_name, clerk_id, profile_photo_url').eq('id', waiting.patient_id).single(),
      supabase.from('patient_profiles').select('date_of_birth').eq('user_id', waiting.patient_id).maybeSingle(),
    ])
    const dob = (patientProfile.data as any)?.date_of_birth
    const patientAge = dob
      ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
      : 0

    const incoming: IncomingRequest = {
      id: waiting.id,
      patientName: (patientData.data as any)?.full_name ?? 'Patient',
      patientAge,
      consultationType: waiting.type ?? 'chat',
      price: Number(waiting.patient_amount) ?? 0,
      currency: 'ETB',
      patientId: waiting.patient_id ?? '',
      patientClerkId: (patientData.data as any)?.clerk_id ?? '',
      patientPhotoUrl: (patientData.data as any)?.profile_photo_url ?? null,
      waitingStartedAt: waiting.waiting_started_at ?? undefined,
    }
    setIncomingRequest(incoming)
  }

  useEffect(() => {
    if (!doctorProfileId) return

    // Listens for '*' (not just UPDATE) so that the doctor's OWN active
    // consultation flipping to 'completed' also re-triggers a check — that's
    // the only signal that a queued waiting_for_doctor request should now be
    // surfaced (it's a different row, so it never gets its own event otherwise).
    const channel = supabase
      .channel(`doctor-requests-${doctorProfileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${doctorProfileId}`,
        },
        async (payload) => {
          const row = payload.new as any
          // This request was handled by another surface (e.g. the doctor
          // tapped a queued push notification into the incoming-request full
          // screen and accepted/declined there) — dismiss our own stale
          // modal for it instead of leaving a second, out-of-date dialog.
          if (row?.status && row.status !== 'waiting_for_doctor') {
            if (useDoctorStore.getState().incomingRequest?.id === row.id) {
              setIncomingRequest(null)
            }
          }
          const token = await getToken()
          if (!token) return
          await checkForWaitingRequest(doctorProfileId, token)
          await loadTodaySchedule(getAuthClient(token))
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel

    // Polling fallback — catches the case where the busy consultation ends
    // (freeing the doctor up) but Realtime doesn't deliver that row's event
    // for some reason, matching the web overlay's 5s poll safety net.
    const poll = setInterval(async () => {
      const token = await getToken()
      if (token) await checkForWaitingRequest(doctorProfileId, token)
    }, 10_000)

    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [doctorProfileId])

  // Guards against a double-tap (or a concurrent stale-notification accept
  // from the incoming-request full screen) firing this handler twice for the
  // same request.
  const respondingRef = useRef(false)

  const handleAccept = async () => {
    const req = incomingRequest
    if (!req || respondingRef.current) return
    respondingRef.current = true
    setIncomingRequest(null)

    // Navigate immediately — the destination screen shows its own
    // connecting/loading state while Stream/Agora initialize in the
    // background below. Never make the doctor wait on Home for channel
    // creation or the DB write (matches the web overlay's optimistic flow).
    const params = {
      consultationId: req.id,
      channelId: req.id,
      patientName: req.patientName,
      patientId: req.patientId ?? '',
    }
    const route =
      req.consultationType === 'phone' ? '/(doctor)/phone-consultation' :
      req.consultationType === 'video' ? '/(doctor)/video-consultation' :
      '/(doctor)/chat-consultation'
    router.replace({ pathname: route, params })
    respondingRef.current = false

    // Fire-and-forget: create the Stream channel and flip status
    // concurrently in the background, without blocking the doctor's own
    // nav. The call screen's watch({members}) lazily creates/joins the
    // channel if it isn't ready yet, so the status write no longer has to
    // wait on the Stream API round-trip before the patient's redirect fires.
    ;(async () => {
      const token = await getToken()

      const channelCreate = (async () => {
        try {
          const doctorUserId = userId ?? user?.id ?? ''
          const streamPatientId = req.patientClerkId || req.patientId
          if (doctorUserId && streamPatientId) {
            await Promise.race([
              createConsultationChannel(req.id, streamPatientId, doctorUserId, {
                doctorName: user?.fullName ?? user?.firstName ?? 'Doctor',
                doctorSubtitle: '',
                doctorPhotoUrl: doctorPhotoUrl ?? user?.imageUrl ?? null,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('stream channel create timeout')), 5000)),
            ])
          }
        } catch {
          // Channel may already exist, or timed out — safe either way
        }
      })()

      const statusUpdate = token
        ? getAuthClient(token)
            .from('consultations')
            .update({ status: 'accepted', started_at: new Date().toISOString() })
            .eq('id', req.id)
        : Promise.resolve()

      await Promise.allSettled([channelCreate, statusUpdate])
    })()
  }

  const handleDecline = async (reason: string) => {
    const req = incomingRequest
    if (!req || respondingRef.current) return
    respondingRef.current = true
    setIncomingRequest(null)

    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({
          status: 'declined',
          decline_reason: reason,
          declined_by: doctorUserRowId,
          declined_at: new Date().toISOString(),
        })
        .eq('id', req.id)
    }
    respondingRef.current = false
  }

  // Heartbeat ping (last_seen_at) runs for the whole doctor session from
  // app/(doctor)/_layout.tsx via useDoctorPresenceSession — not here — so it
  // keeps going after navigating off this tab into a live consultation.

  const isPending = doctorStatus && doctorStatus !== 'approved'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {incomingRequest && doctorStatus === 'approved' && (
        <IncomingRequestModal
          visible={!!incomingRequest}
          patientName={incomingRequest.patientName}
          patientAge={incomingRequest.patientAge}
          patientPhotoUrl={incomingRequest.patientPhotoUrl}
          consultationType={incomingRequest.consultationType}
          price={incomingRequest.price}
          currency={incomingRequest.currency}
          consultationId={incomingRequest.id}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* ── Gradient Header ── */}
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{(new Date().getHours() < 12 ? t('goodMorning') : new Date().getHours() < 17 ? t('goodAfternoon') : t('goodEvening'))}, Dr. {firstName}</Text>
            <Text style={styles.dateText}>{getFormattedDate()}</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable style={styles.bellBtn} hitSlop={8} onPress={() => router.push('/(doctor)/(tabs)/messages')}>
              <Ionicons name="notifications-outline" size={24} color={colors.mistWhite} />
              {incomingRequest && <View style={styles.bellBadge} />}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(doctor)/(tabs)/profile')}
              style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
            >
              {(doctorPhotoUrl ?? user?.imageUrl) ? (
                <Image source={{ uri: (doctorPhotoUrl ?? user?.imageUrl) as string }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{firstName[0].toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </LinearGradient>

        {/* ── Pending / Rejected Banner ── */}
        {isPending && (
          <View style={[styles.pendingBanner, (doctorStatus === 'rejected' || doctorStatus === 'suspended') && styles.rejectedBanner]}>
            <Ionicons
              name={doctorStatus === 'rejected' ? 'close-circle-outline' : doctorStatus === 'suspended' ? 'ban-outline' : 'time-outline'}
              size={20}
              color={doctorStatus === 'rejected' || doctorStatus === 'suspended' ? colors.error : '#92400E'}
            />
            <Text style={[styles.pendingBannerText, (doctorStatus === 'rejected' || doctorStatus === 'suspended') && styles.rejectedBannerText]}>
              {doctorStatus === 'rejected'
                ? 'Your application was not approved. Please contact support.'
                : doctorStatus === 'suspended'
                ? 'Your account has been suspended. Please contact support.'
                : 'Your account is under review. You cannot perform any actions until the admin approves you.'}
            </Text>
          </View>
        )}

        <View style={styles.body}>
          {/* ── Online Toggle ── */}
          {!isPending && (
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot}>
                <View style={[styles.onlineDotInner, { backgroundColor: isOnline ? colors.success : colors.steelGrey }]} />
              </View>
              <Text style={styles.onlineLabel}>{isOnline ? 'Online · Taking Patients' : 'Go Online'}</Text>
              <Switch
                value={isOnline}
                onValueChange={toggleOnline}
                disabled={togglingOnline}
                trackColor={{ true: colors.success, false: colors.steelGrey }}
                thumbColor={colors.mistWhite}
              />
            </View>
          )}

          {/* ── Today's Stats ── */}
          <Text style={styles.sectionTitle}>{t('todayStats')}</Text>
          <View style={styles.statsRow}>
            {[
              { icon: 'medical-outline', value: String(stats.totalConsultations), label: 'Total Consultations', color: colors.careBlue },
              { icon: 'checkmark-circle-outline', value: String(stats.completedToday), label: 'Completed Today', color: colors.tealGreen },
              { icon: 'star-outline', value: stats.rating > 0 ? stats.rating.toFixed(1) : '—', label: t('rating'), color: colors.warning },
              { icon: 'wallet-outline', value: `ETB ${stats.earnings.toLocaleString()}`, label: 'Total Earnings', color: colors.tealGreen },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Ionicons name={stat.icon as never} size={22} color={stat.color} />
                <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Today's Schedule ── */}
          <Text style={[styles.sectionTitle, styles.mt20]}>{t('todaySchedule')}</Text>
          {schedule.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={40} color={colors.steelGrey} />
              <Text style={styles.emptyText}>{t('noScheduledAppts')}</Text>
            </View>
          ) : (
            schedule.map((item) => (
              <View key={item.id} style={styles.scheduleItem}>
                <View style={styles.scheduleIconWrap}>
                  <Ionicons name={CONSULTATION_ICONS[item.type]} size={20} color={colors.inkBlack} />
                </View>
                <View style={styles.scheduleInfo}>
                  <Text style={styles.schedulePatient}>{item.patientName}</Text>
                  <Text style={styles.scheduleTime}>{item.time} · {item.type.charAt(0).toUpperCase() + item.type.slice(1)}</Text>
                </View>
                <View style={styles.scheduleDot} />
              </View>
            ))
          )}

          {/* ── Quick Actions ── */}
          <Text style={[styles.sectionTitle, styles.mt20]}>{t('quickActions')}</Text>
          <View style={styles.quickRow}>
            {[
              { icon: 'calendar-outline', label: t('upcomingAppts'), route: '/(doctor)/(tabs)/schedule' },
              { icon: 'cash-outline', label: t('earnings'), route: '/(doctor)/(tabs)/profile' },
              { icon: 'star-outline', label: t('myReviews'), route: '/(doctor)/(tabs)/profile' },
            ].map((action) => (
              <Pressable
                key={action.label}
                onPress={() => router.push(action.route as never)}
                style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name={action.icon as never} size={24} color={colors.careBlue} />
                <Text style={styles.quickLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 24 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scrollContent: { paddingBottom: 24 },
  body: { paddingHorizontal: 20, paddingTop: 16 },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellBtn: { position: 'relative', padding: 4 },
  bellBadge: { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.careBlue },
  greeting: { fontFamily: fonts.bold, fontSize: 20, color: colors.mistWhite, lineHeight: 26 },
  dateText: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  avatarBtn: { borderRadius: 22 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite },

  pendingBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FEF3C7', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  rejectedBanner: { backgroundColor: '#FEE2E2', borderBottomColor: '#FECACA' },
  pendingBannerText: { fontFamily: fonts.medium, fontSize: 13, color: '#92400E', flex: 1, lineHeight: 18 },
  rejectedBannerText: { color: colors.error },

  onlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    marginBottom: 16, ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  onlineDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  onlineDotInner: { width: 10, height: 10, borderRadius: 5 },
  onlineLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, flex: 1 },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 12 },
  mt20: { marginTop: 20 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  statValue: { fontFamily: fonts.bold, fontSize: 16 },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', textAlign: 'center' },

  scheduleItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  scheduleIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  scheduleTypeIcon: { fontSize: 20 },
  scheduleInfo: { flex: 1 },
  schedulePatient: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  scheduleTime: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  scheduleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealGreen },

  emptyWrap: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#9CA3AF' },

  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flex: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14, alignItems: 'center', gap: 8,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkBlack, textAlign: 'center' },
})
