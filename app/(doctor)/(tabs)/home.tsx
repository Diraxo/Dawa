import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
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
import { shadow } from '@/lib/shadow'
import { createConsultationChannel } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { type IncomingRequest, useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

const CONSULTATION_ICONS = { chat: '💬', phone: '📞', video: '🎥' }

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

  const rawFirstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'Doctor'
  const firstName = rawFirstName.replace(/^Dr\.?\s*/i, '').trim() || 'Doctor'

  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [stats, setStats] = useState({ totalConsultations: 0, completedToday: 0, earnings: 0, rating: 0 })
  const [isOnline, setIsOnline] = useState(false)
  const [togglingOnline, setTogglingOnline] = useState(false)
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Load doctor profile ID + today's data ─────────────────────────────────
  useEffect(() => {
    getToken().then(async token => {
      if (!token) return
      const client = getAuthClient(token)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

      const [profileRes, schedRes, todayStatsRes, allEarningsRes] = await Promise.all([
        client.from('doctor_profiles').select('id, rating_average, total_consultations, is_online').single(),
        client
          .from('consultations')
          .select(`id, type, scheduled_at, patient:users!consultations_patient_id_fkey(full_name)`)
          .gte('scheduled_at', today.toISOString())
          .lt('scheduled_at', tomorrow.toISOString())
          .in('status', ['pending', 'active', 'waiting_for_doctor', 'accepted', 'in_progress'])
          .order('scheduled_at', { ascending: true }),
        client.from('consultations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('ended_at', today.toISOString()),
        client.from('consultations')
          .select('doctor_amount')
          .eq('status', 'completed'),
      ])

      if (profileRes.data) {
        const p = profileRes.data as any
        const profileId: string = p.id
        setDoctorProfileId(profileId)
        setIsOnline(p.is_online ?? false)
        const rating = Number(p.rating_average ?? 0)
        const completedToday = todayStatsRes.count ?? 0
        const totalConsultations = p.total_consultations ?? 0
        const earnings = (allEarningsRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.doctor_amount) || 0), 0)
        setStats({ totalConsultations, completedToday, earnings, rating })

        // Show incoming request modal for any consultation already waiting
        // when the doctor opens the screen (Realtime only catches future updates)
        const { data: waiting } = await client
          .from('consultations')
          .select('id, type, patient_id, patient_amount, waiting_started_at')
          .eq('doctor_id', profileId)
          .eq('status', 'waiting_for_doctor')
          .eq('payment_status', 'paid')
          .order('waiting_started_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (waiting && !incomingRequest) {
          const [patientData, patientProfile] = await Promise.all([
            supabase.from('users').select('full_name, clerk_id').eq('id', (waiting as any).patient_id).single(),
            supabase.from('patient_profiles').select('date_of_birth').eq('user_id', (waiting as any).patient_id).maybeSingle(),
          ])
          const dob = (patientProfile.data as any)?.date_of_birth
          const patientAge = dob
            ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
            : 0
          shownConsultationIds.current.add((waiting as any).id)
          setIncomingRequest({
            id: (waiting as any).id,
            patientName: (patientData.data as any)?.full_name ?? 'Patient',
            patientAge,
            consultationType: (waiting as any).type ?? 'chat',
            price: Number((waiting as any).patient_amount) ?? 0,
            currency: 'ETB',
            patientId: (waiting as any).patient_id ?? '',
            patientClerkId: (patientData.data as any)?.clerk_id ?? '',
            waitingStartedAt: (waiting as any).waiting_started_at ?? undefined,
          })
        }
      }

      if (schedRes.data) {
        setSchedule(schedRes.data.map((r: any) => ({
          id: r.id,
          patientName: (r.patient as any)?.full_name ?? 'Patient',
          time: new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          type: r.type ?? 'chat',
        })))
      }
    })
  }, [])

  // ── Realtime: show incoming request only once payment is confirmed ────────
  // Listens for UPDATE events so we trigger only when the Chapa webhook sets
  // payment_status = 'paid', not when the consultation is first inserted
  // (at that point payment is still pending).
  const shownConsultationIds = useRef(new Set<string>())

  useEffect(() => {
    if (!doctorProfileId) return

    const channel = supabase
      .channel(`doctor-requests-${doctorProfileId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${doctorProfileId}`,
        },
        async (payload) => {
          const row = payload.new as any
          // Only trigger when patient has paid and is waiting (new flow)
          if (row.status !== 'waiting_for_doctor') return
          if (row.payment_status !== 'paid') return
          // Deduplicate — UPDATE can fire multiple times for the same row
          if (shownConsultationIds.current.has(row.id)) return
          shownConsultationIds.current.add(row.id)

          const [patientData, patientProfile] = await Promise.all([
            supabase.from('users').select('full_name, clerk_id').eq('id', row.patient_id).single(),
            supabase.from('patient_profiles').select('date_of_birth').eq('user_id', row.patient_id).maybeSingle(),
          ])

          const dob = (patientProfile.data as any)?.date_of_birth
          const patientAge = dob
            ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
            : 0

          const incoming: IncomingRequest = {
            id: row.id,
            patientName: (patientData.data as any)?.full_name ?? 'Patient',
            patientAge,
            consultationType: row.type ?? 'chat',
            price: Number(row.patient_amount) ?? 0,
            currency: 'ETB',
            patientId: row.patient_id ?? '',
            patientClerkId: (patientData.data as any)?.clerk_id ?? '',
            waitingStartedAt: row.waiting_started_at ?? undefined,
          }
          setIncomingRequest(incoming)
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [doctorProfileId])

  const handleAccept = async () => {
    const req = incomingRequest
    setIncomingRequest(null)
    if (!req) return

    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({ status: 'accepted', started_at: new Date().toISOString() })
        .eq('id', req.id)
    }

    // Create the Stream chat channel so both parties can connect.
    // Use the patient's Clerk user ID (not their Supabase UUID) — Stream user IDs = Clerk IDs.
    try {
      const doctorUserId = userId ?? user?.id ?? ''
      const streamPatientId = req.patientClerkId || req.patientId
      if (doctorUserId && streamPatientId) {
        await createConsultationChannel(req.id, streamPatientId, doctorUserId, {
          doctorName: user?.fullName ?? user?.firstName ?? 'Doctor',
          doctorSubtitle: '',
          doctorPhotoUrl: user?.imageUrl ?? null,
        })
      }
    } catch {
      // Channel may already exist — that's fine
    }

    const params = {
      consultationId: req.id,
      channelId: req.id,
      patientName: req.patientName,
      patientId: req.patientId ?? '',
    }
    if (req.consultationType === 'phone') {
      router.push({ pathname: '/(doctor)/phone-consultation', params })
    } else if (req.consultationType === 'video') {
      router.push({ pathname: '/(doctor)/video-consultation', params })
    } else {
      router.push({ pathname: '/(doctor)/chat-consultation', params })
    }
  }

  const handleDecline = async () => {
    const req = incomingRequest
    setIncomingRequest(null)
    if (!req) return

    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({ status: 'declined' })
        .eq('id', req.id)
    }
  }

  const toggleOnline = async () => {
    if (!doctorProfileId || togglingOnline) return
    setTogglingOnline(true)
    const newStatus = !isOnline
    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('doctor_profiles')
        .update({ is_online: newStatus })
        .eq('id', doctorProfileId)
      setIsOnline(newStatus)
    }
    setTogglingOnline(false)
  }

  const isPending = doctorStatus && doctorStatus !== 'approved'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {incomingRequest && (
        <IncomingRequestModal
          visible={!!incomingRequest}
          patientName={incomingRequest.patientName}
          patientAge={incomingRequest.patientAge}
          consultationType={incomingRequest.consultationType}
          price={incomingRequest.price}
          currency={incomingRequest.currency}
          consultationId={incomingRequest.id}
          waitingStartedAt={incomingRequest.waitingStartedAt}
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
              {user?.imageUrl ? (
                <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
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
          <View style={[styles.pendingBanner, doctorStatus === 'rejected' && styles.rejectedBanner]}>
            <Ionicons
              name={doctorStatus === 'rejected' ? 'close-circle-outline' : 'time-outline'}
              size={20}
              color={doctorStatus === 'rejected' ? colors.error : '#92400E'}
            />
            <Text style={[styles.pendingBannerText, doctorStatus === 'rejected' && styles.rejectedBannerText]}>
              {doctorStatus === 'rejected'
                ? 'Your application was not approved. Please contact support.'
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
              { icon: 'medical-outline', value: String(stats.totalConsultations), label: t('consultations'), color: colors.careBlue },
              { icon: 'checkmark-circle-outline', value: String(stats.completedToday), label: 'Today', color: colors.tealGreen },
              { icon: 'star-outline', value: stats.rating > 0 ? stats.rating.toFixed(1) : '—', label: t('rating'), color: colors.warning },
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
                  <Text style={styles.scheduleTypeIcon}>{CONSULTATION_ICONS[item.type]}</Text>
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

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
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
