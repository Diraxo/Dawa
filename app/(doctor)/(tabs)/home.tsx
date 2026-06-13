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
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { IncomingRequestModal } from '@/components/doctor/IncomingRequestModal'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { getAuthClient, supabase } from '@/lib/supabase'
import { type IncomingRequest, useDoctorStore } from '@/store/doctorStore'

const CONSULTATION_ICONS = { chat: '💬', phone: '📞', video: '🎥' }

interface ScheduleItem {
  id: string; patientName: string; time: string; type: 'chat' | 'phone' | 'video'
}

function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function DoctorHomeScreen() {
  const router = useRouter()
  const { user } = useUser()
  const { getToken } = useAuth()
  const { isOnline, setIsOnline, incomingRequest, setIncomingRequest } = useDoctorStore()

  const firstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'Doctor'

  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [stats, setStats] = useState({ consultations: 0, earnings: 0, rating: 0 })
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Load doctor profile ID + today's data ─────────────────────────────────
  useEffect(() => {
    getToken().then(async token => {
      if (!token) return
      const client = getAuthClient(token)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

      const [profileRes, schedRes, statsRes] = await Promise.all([
        // Doctor profile (id needed for Realtime filter)
        client.from('doctor_profiles').select('id, rating_average').single(),
        // Today's schedule
        client
          .from('consultations')
          .select(`id, type, scheduled_at, patient:users!consultations_patient_id_fkey(full_name)`)
          .gte('scheduled_at', today.toISOString())
          .lt('scheduled_at', tomorrow.toISOString())
          .in('status', ['pending', 'active'])
          .order('scheduled_at', { ascending: true }),
        // Today's completed stats
        client.from('consultations')
          .select('id, patient_amount', { count: 'exact' })
          .eq('status', 'completed')
          .gte('ended_at', today.toISOString()),
      ])

      if (profileRes.data) {
        setDoctorProfileId((profileRes.data as any).id)
        const rating = Number((profileRes.data as any).rating_average ?? 0)
        const count = statsRes.count ?? 0
        const earned = (statsRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.patient_amount) || 0), 0)
        setStats({ consultations: count, earnings: earned, rating })
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

  // ── Realtime: listen for new pending consultations ─────────────────────────
  useEffect(() => {
    if (!doctorProfileId) return

    const channel = supabase
      .channel(`doctor-requests-${doctorProfileId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${doctorProfileId}`,
        },
        async (payload) => {
          const row = payload.new as any
          if (row.status !== 'pending') return

          // Fetch patient name
          const { data: patientData } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', row.patient_id)
            .single()

          const incoming: IncomingRequest = {
            id: row.id,
            patientName: (patientData as any)?.full_name ?? 'Patient',
            patientAge: 0,
            consultationType: row.type ?? 'chat',
            price: Number(row.patient_amount) ?? 0,
            currency: 'ETB',
          }
          setIncomingRequest(incoming)
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [doctorProfileId])

  // ── Toggle online / offline — syncs to Supabase ───────────────────────────
  const updateOnlineStatus = async (online: boolean) => {
    setIsOnline(online)
    const token = await getToken()
    if (token && doctorProfileId) {
      await getAuthClient(token)
        .from('doctor_profiles')
        .update({ is_online: online })
        .eq('id', doctorProfileId)
    }
  }

  const handleGoOnline = () => {
    if (isOnline) {
      Alert.alert('Go Offline?', 'Patients will not be able to send you consultation requests.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go Offline', onPress: () => updateOnlineStatus(false) },
      ])
    } else {
      updateOnlineStatus(true)
    }
  }

  const handleAccept = async () => {
    const req = incomingRequest
    setIncomingRequest(null)
    if (!req) return

    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', req.id)
    }

    const params = { consultationId: req.id, patientName: req.patientName }
    if (req.consultationType === 'phone') {
      router.push({ pathname: '/(doctor)/phone-consultation', params })
    } else if (req.consultationType === 'video') {
      router.push({ pathname: '/(doctor)/video-consultation', params })
    } else {
      router.push({ pathname: '/(doctor)/chat-consultation', params })
    }
  }

  const handleDecline = async (reason: string) => {
    const req = incomingRequest
    setIncomingRequest(null)
    if (!req) return

    const token = await getToken()
    if (token) {
      await getAuthClient(token)
        .from('consultations')
        .update({ status: 'cancelled' })
        .eq('id', req.id)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Incoming request modal */}
      {incomingRequest && (
        <IncomingRequestModal
          visible={!!incomingRequest}
          patientName={incomingRequest.patientName}
          patientAge={incomingRequest.patientAge}
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
            <Text style={styles.greeting}>{getGreeting()}, Dr. {firstName}</Text>
            <Text style={styles.dateText}>{getFormattedDate()}</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable style={styles.bellBtn} hitSlop={8}>
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

        <View style={styles.body}>
          {/* ── GO ONLINE / OFFLINE Toggle ── */}
          <View style={[styles.onlineCard, isOnline && styles.onlineCardActive]}>
            <View style={styles.onlineLeft}>
              {isOnline ? (
                <>
                  <View style={styles.pulseDotWrap}>
                    <View style={styles.pulseDot} />
                    <View style={[styles.pulseDot, styles.pulseRing]} />
                  </View>
                  <View>
                    <Text style={[styles.onlineStatus, styles.onlineStatusActive]}>You are Online</Text>
                    <Text style={styles.onlineSubtext}>Patients can request consultations</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.pulseDotWrap}>
                    <View style={[styles.pulseDot, styles.pulseDotOffline]} />
                  </View>
                  <View>
                    <Text style={styles.onlineStatus}>You are Offline</Text>
                    <Text style={styles.onlineSubtext}>You won&apos;t receive new requests</Text>
                  </View>
                </>
              )}
            </View>
            <Pressable onPress={handleGoOnline} style={styles.toggleBtnWrap}>
              {isOnline ? (
                <View style={styles.toggleBtnOffline}>
                  <Text style={styles.toggleBtnOfflineText}>Go Offline</Text>
                </View>
              ) : (
                <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.toggleBtnOnline}>
                  <Text style={styles.toggleBtnOnlineText}>Go Online</Text>
                </LinearGradient>
              )}
            </Pressable>
          </View>

          {/* ── Today's Stats ── */}
          <Text style={styles.sectionTitle}>Today&apos;s Stats</Text>
          <View style={styles.statsRow}>
            {[
              { icon: 'medical-outline', value: String(stats.consultations), label: 'Consultations', color: colors.careBlue },
              { icon: 'cash-outline', value: `ETB ${stats.earnings}`, label: 'Earnings', color: colors.tealGreen },
              { icon: 'star-outline', value: stats.rating > 0 ? stats.rating.toFixed(1) : '—', label: 'My Rating', color: colors.warning },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Ionicons name={stat.icon as never} size={22} color={stat.color} />
                <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Today's Schedule ── */}
          <Text style={[styles.sectionTitle, styles.mt20]}>Today&apos;s Schedule</Text>
          {schedule.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={40} color={colors.steelGrey} />
              <Text style={styles.emptyText}>No appointments today</Text>
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
          <Text style={[styles.sectionTitle, styles.mt20]}>Quick Actions</Text>
          <View style={styles.quickRow}>
            {[
              { icon: 'calendar-outline', label: 'View Schedule', route: '/(doctor)/(tabs)/schedule' },
              { icon: 'cash-outline', label: 'My Earnings', route: '/(doctor)/(tabs)/profile' },
              { icon: 'star-outline', label: 'My Reviews', route: '/(doctor)/(tabs)/profile' },
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

  onlineCard: {
    backgroundColor: colors.mistWhite, borderRadius: 20, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1.5, borderColor: colors.steelGrey,
  },
  onlineCardActive: { borderColor: colors.success, backgroundColor: '#F0FDF4' },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  pulseDotWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pulseDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, position: 'absolute' },
  pulseRing: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,203,83,0.25)', position: 'absolute' },
  pulseDotOffline: { backgroundColor: '#D1D5DB' },
  onlineStatus: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkBlack },
  onlineStatusActive: { color: '#15803D' },
  onlineSubtext: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  toggleBtnWrap: { borderRadius: 12, overflow: 'hidden' },
  toggleBtnOnline: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  toggleBtnOnlineText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
  toggleBtnOffline: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.steelGrey, backgroundColor: colors.cloudGrey },
  toggleBtnOfflineText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 12 },
  mt20: { marginTop: 20 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  statValue: { fontFamily: fonts.bold, fontSize: 16 },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', textAlign: 'center' },

  scheduleItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
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
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkBlack, textAlign: 'center' },
})
