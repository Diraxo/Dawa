import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop } from '@react-navigation/native'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { QuickActionCard } from '@/components/ui/QuickActionCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

function mapDoctor(d: any): Doctor {
  return {
    id: d.id,
    name: d.users?.full_name ?? 'Dr. Unknown',
    subtitle: d.hospital_name ?? undefined,
    specialty: d.specialty ?? 'General',
    rating_average: Number(d.rating_average) ?? 0,
    review_count: d.total_consultations ?? 0,
    years_experience: d.years_experience ?? undefined,
    bio: d.bio ?? undefined,
    chat_price: Number(d.chat_price) ?? 0,
    phone_price: Number(d.phone_price) ?? 0,
    video_price: Number(d.video_price) ?? 0,
    is_online: d.is_online ?? false,
    profile_photo_url: d.users?.profile_photo_url ?? null,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { user } = useUser()
  const { getToken } = useAuth()
  const scrollRef = useRef<ScrollView>(null)
  useScrollToTop(scrollRef)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null)
  const [onlineDoctors, setOnlineDoctors] = useState<Doctor[]>([])
  const [topDoctors, setTopDoctors] = useState<Doctor[]>([])
  const [loadingDoctors, setLoadingDoctors] = useState(true)
  const [specialties, setSpecialties] = useState<string[]>([])
  const [upcomingAppointment, setUpcomingAppointment] = useState<{
    doctorName: string; type: string; date: string; time: string
  } | null>(null)
  const [activeConsultation, setActiveConsultation] = useState<{
    id: string; doctorId: string; doctorName: string; type: string; status: string
  } | null>(null)

  useEffect(() => {
    if (!user) return
    let mounted = true
    setLoadingDoctors(true)

    ;(async () => {
      // Public doctor/specialty data — no auth required
      const [onlineRes, topRes, specsRes] = await Promise.all([
        supabase
          .from('doctor_profiles')
          .select('*, users!inner(full_name, profile_photo_url)')
          .eq('status', 'approved')
          .eq('is_online', true)
          .order('rating_average', { ascending: false })
          .limit(8),
        supabase
          .from('doctor_profiles')
          .select('*, users!inner(full_name, profile_photo_url)')
          .eq('status', 'approved')
          .order('rating_average', { ascending: false })
          .limit(8),
        supabase
          .from('specialties')
          .select('name')
          .order('name', { ascending: true }),
      ])

      if (!mounted) return
      if (onlineRes.data) setOnlineDoctors(onlineRes.data.map(mapDoctor))
      if (topRes.data) setTopDoctors(topRes.data.map(mapDoctor))
      if (specsRes.data?.length) setSpecialties(specsRes.data.map((s: { name: string }) => s.name))
      setLoadingDoctors(false)

      // Upcoming appointment — requires patient's Supabase UUID for explicit filtering
      const token = await getToken()
      if (!token || !mounted) return
      const client = getAuthClient(token)
      const { data: me } = await client.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
      if (!me || !mounted) return

      const [apptRes, activeRes] = await Promise.all([
        client
          .from('consultations')
          .select('id, type, scheduled_at, doctor_profiles!inner(users!inner(full_name))')
          .eq('patient_id', (me as any).id)
          .in('status', ['pending', 'active'])
          .order('scheduled_at', { ascending: true })
          .limit(1),
        client
          .from('consultations')
          .select('id, type, status, doctor_id, doctor_profiles!inner(users!inner(full_name))')
          .eq('patient_id', (me as any).id)
          .in('status', ['waiting_for_doctor', 'accepted', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      if (!mounted) return
      if (apptRes.data?.length) {
        const appt = apptRes.data[0] as any
        const d = new Date(appt.scheduled_at)
        setUpcomingAppointment({
          doctorName: (appt.doctor_profiles as any)?.users?.full_name ?? 'Doctor',
          type: appt.type ?? 'chat',
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        })
      }
      if (activeRes.data?.length) {
        const c = activeRes.data[0] as any
        setActiveConsultation({
          id: c.id,
          doctorId: c.doctor_id,
          doctorName: (c.doctor_profiles as any)?.users?.full_name ?? 'Doctor',
          type: c.type ?? 'chat',
          status: c.status,
        })
      }
    })()

    return () => { mounted = false }
  }, [user])

  // Realtime: doctor online/offline status → update lists instantly
  useEffect(() => {
    const channel = supabase
      .channel('patient-home-doctor-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
        async (payload) => {
          const updated = payload.new as any
          if (updated.status !== 'approved') return
          const doctorId: string = updated.id
          const isNowOnline: boolean = updated.is_online

          if (isNowOnline) {
            // Fetch full profile (payload.new lacks the users join)
            const { data } = await supabase
              .from('doctor_profiles')
              .select('*, users!inner(full_name, profile_photo_url)')
              .eq('id', doctorId)
              .single()
            if (data) {
              const doctor = mapDoctor(data)
              setOnlineDoctors(prev =>
                prev.some(d => d.id === doctorId)
                  ? prev.map(d => d.id === doctorId ? doctor : d)
                  : [doctor, ...prev]
              )
              setTopDoctors(prev =>
                prev.map(d => d.id === doctorId ? { ...d, is_online: true } : d)
              )
            }
          } else {
            setOnlineDoctors(prev => prev.filter(d => d.id !== doctorId))
            setTopDoctors(prev =>
              prev.map(d => d.id === doctorId ? { ...d, is_online: false } : d)
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Realtime: update active consultation banner when status changes
  useEffect(() => {
    if (!activeConsultation) return
    const channel = supabase
      .channel(`patient-home-active-${activeConsultation.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${activeConsultation.id}` },
        (payload) => {
          const updated = payload.new as any
          if (['waiting_for_doctor', 'accepted', 'in_progress'].includes(updated.status)) {
            setActiveConsultation(prev => prev ? { ...prev, status: updated.status } : null)
          } else {
            setActiveConsultation(null)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeConsultation?.id])

  const firstName =
    user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'there'

  function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return t('goodMorning')
    if (hour < 17) return t('goodAfternoon')
    return t('goodEvening')
  }

  const handleDoctorPress = (id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  }

  const handleSpecialtyPress = (specialty: string) => {
    setSelectedSpecialty((prev) => (prev === specialty ? null : specialty))
  }

  const filterDoctors = (docs: Doctor[]) => {
    let result = docs
    if (selectedSpecialty) {
      result = result.filter((d) => d.specialty === selectedSpecialty)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.specialty.toLowerCase().includes(q) ||
          (d.bio ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }

  const filteredOnline = filterDoctors(onlineDoctors)
  const filteredTop = filterDoctors(topDoctors)

  const handleActiveBannerPress = () => {
    if (!activeConsultation) return
    if (activeConsultation.status === 'waiting_for_doctor') {
      router.push({
        pathname: '/(patient)/waiting-room' as any,
        params: { doctorId: activeConsultation.doctorId, consultationId: activeConsultation.id, type: activeConsultation.type },
      })
    } else {
      const screen = activeConsultation.type === 'video'
        ? '/(patient)/video-consultation'
        : activeConsultation.type === 'phone'
        ? '/(patient)/phone-consultation'
        : '/(patient)/chat-consultation'
      router.push({
        pathname: screen as any,
        params: { consultationId: activeConsultation.id, doctorId: activeConsultation.doctorId, doctorName: activeConsultation.doctorName },
      })
    }
  }

  const handleQuickAction = () => {
    router.push('/(patient)/(tabs)/doctors')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>
              {getGreeting()}, {firstName}
            </Text>
            <Text style={styles.dateText}>{getFormattedDate()}</Text>
          </View>
          <Pressable
            onPress={() => router.push('/(patient)/(tabs)/profile')}
            style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.75 }]}
          >
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* ── Search Bar ── */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchDoctorPlaceholder')}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </Pressable>
          )}
        </View>

        {/* ── Active Consultation Banner ── */}
        {activeConsultation && (
          <Pressable
            style={({ pressed }) => [styles.activeBanner, pressed && { opacity: 0.9 }]}
            onPress={handleActiveBannerPress}
          >
            <View style={styles.activeBannerLeft}>
              <View style={styles.activeBannerDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activeBannerTitle} numberOfLines={1}>
                  {activeConsultation.status === 'waiting_for_doctor'
                    ? `Waiting for Dr. ${activeConsultation.doctorName}`
                    : `Active session · Dr. ${activeConsultation.doctorName}`}
                </Text>
                <Text style={styles.activeBannerSub}>Tap to return</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.tealGreen} />
          </Pressable>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.quickActionsHeader}>
          <Text style={styles.sectionTitle}>{t('quickActions')}</Text>
          <Text style={styles.sectionSubtitle}>{t('startConsultation')}</Text>
        </View>
        <View style={styles.quickActionsRow}>
          <QuickActionCard
            label={t('chatConsult')}
            icon="chatbubble-ellipses"
            variant="outline"
            onPress={handleQuickAction}
          />
          <QuickActionCard
            label={t('phoneCall')}
            icon="call"
            variant="teal"
            onPress={handleQuickAction}
          />
          <QuickActionCard
            label={t('videoCall')}
            icon="videocam"
            variant="blue"
            onPress={handleQuickAction}
          />
        </View>

        {/* ── Specialties ── */}
        <Text style={[styles.sectionTitle, styles.mt24]}>{t('specialties')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.specialtiesRow}
          style={styles.mt12}
        >
          {specialties.map((specialty) => {
            const selected = selectedSpecialty === specialty
            return (
              <Pressable
                key={specialty}
                onPress={() => handleSpecialtyPress(specialty)}
                style={({ pressed }) => [
                  styles.pill,
                  selected && styles.pillSelected,
                  pressed && { opacity: 0.8 },
                ]}
              >
                {selected && (
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={colors.mistWhite}
                    style={styles.checkIcon}
                  />
                )}
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {specialty}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {/* ── Available Now ── */}
        <View style={[styles.sectionRow, styles.mt24]}>
          <Text style={styles.sectionTitle}>{t('availableNow')}</Text>
          <View style={styles.onlineDot} />
        </View>
        {loadingDoctors ? (
          <View style={[styles.emptyDoctorCard, styles.mt12]}>
            <Text style={styles.emptyDoctorText}>{t('loadingDoctors')}</Text>
          </View>
        ) : filteredOnline.length === 0 ? (
          <View style={[styles.emptyDoctorCard, styles.mt12]}>
            <Ionicons name="person-outline" size={28} color={colors.steelGrey} />
            <Text style={styles.emptyDoctorText}>{t('noDoctorsOnline')}</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.doctorListContent}
            style={styles.mt12}
          >
            {filteredOnline.map((doc) => (
              <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} />
            ))}
          </ScrollView>
        )}

        {/* ── Top Rated Doctors ── */}
        <View style={[styles.sectionRowSpaced, styles.mt28]}>
          <Text style={styles.sectionTitle}>{t('topRatedDoctors')}</Text>
          <Pressable onPress={() => router.push('/(patient)/(tabs)/doctors')}>
            <Text style={styles.seeAll}>{t('seeAll')}</Text>
          </Pressable>
        </View>
        {loadingDoctors ? (
          <View style={[styles.emptyDoctorCard, styles.mt12]}>
            <Text style={styles.emptyDoctorText}>{t('loading')}</Text>
          </View>
        ) : filteredTop.length === 0 ? (
          <View style={[styles.emptyDoctorCard, styles.mt12]}>
            <Ionicons name="medical-outline" size={28} color={colors.steelGrey} />
            <Text style={styles.emptyDoctorText}>{t('noApprovedDoctors')}</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.doctorListContent}
            style={styles.mt12}
          >
            {filteredTop.map((doc) => (
              <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} />
            ))}
          </ScrollView>
        )}

        {/* ── Upcoming Appointment ── */}
        <Text style={[styles.sectionTitle, styles.mt28]}>{t('upcomingAppointment')}</Text>
        {upcomingAppointment ? (
          <Pressable
            style={({ pressed }) => [styles.appointmentCard, pressed && { opacity: 0.9 }]}
            onPress={() => router.push('/(patient)/(tabs)/appointments')}
          >
            <LinearGradient
              colors={gradients.hero}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.appointmentGradient}
            >
              <View style={styles.apptLeft}>
                <View style={styles.apptIconWrap}>
                  <Ionicons name="time-outline" size={22} color={colors.mistWhite} />
                </View>
                <View style={styles.apptInfo}>
                  <Text style={styles.apptTitle}>
                    Consultation with {upcomingAppointment.doctorName}
                  </Text>
                  <Text style={styles.apptMeta}>
                    {upcomingAppointment.type} · {upcomingAppointment.date} at{' '}
                    {upcomingAppointment.time}
                  </Text>
                </View>
              </View>
              <View style={styles.viewDetailsBtn}>
                <Text style={styles.viewDetailsText}>{t('viewDetails')}</Text>
              </View>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.emptyApptCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(patient)/(tabs)/doctors')}
          >
            <Ionicons name="calendar-outline" size={28} color={colors.steelGrey} />
            <Text style={styles.emptyApptText}>{t('noUpcomingAppointments')}</Text>
            <Text style={styles.emptyApptSub}>{t('bookConsultationToStart')}</Text>
          </Pressable>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cloudGrey,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.inkBlack,
    lineHeight: 26,
  },
  dateText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  avatarBtn: {
    borderRadius: 22,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.careBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.mistWhite,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mistWhite,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 24,
    gap: 10,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.inkBlack,
    padding: 0,
  },

  // Section headers
  quickActionsHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: colors.inkBlack,
  },
  sectionSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionRowSpaced: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  seeAll: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.tealGreen,
  },

  // Quick Actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // Specialties
  specialtiesRow: {
    gap: 10,
    paddingRight: 20,
    paddingBottom: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.mistWhite,
    borderWidth: 1,
    borderColor: colors.steelGrey,
  },
  pillSelected: {
    backgroundColor: colors.tealGreen,
    borderColor: colors.tealGreen,
  },
  checkIcon: {
    marginRight: 4,
  },
  pillText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#374151',
  },
  pillTextSelected: {
    color: colors.mistWhite,
  },

  // Doctor lists
  doctorListContent: {
    paddingRight: 20,
    paddingBottom: 4,
  },

  // Upcoming Appointment
  appointmentCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 14,
    ...shadow(colors.careBlue, 0, 4, 12, 0.22, 4),
  },
  appointmentGradient: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  apptLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  apptIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptInfo: {
    flex: 1,
  },
  apptTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.mistWhite,
    marginBottom: 4,
  },
  apptMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  viewDetailsBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  viewDetailsText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: colors.mistWhite,
  },

  // Empty doctor state
  emptyDoctorCard: {
    alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 80, borderRadius: 16, borderWidth: 1.5,
    borderColor: colors.steelGrey, borderStyle: 'dashed',
    backgroundColor: colors.mistWhite,
  },
  emptyDoctorText: {
    fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF',
  },

  // Empty appointment state
  emptyApptCard: {
    marginTop: 14, borderRadius: 20, padding: 24,
    backgroundColor: colors.mistWhite, alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.steelGrey, borderStyle: 'dashed',
  },
  emptyApptText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  emptyApptSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280' },

  // Active consultation banner
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#ECFDF5', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 16, borderWidth: 1, borderColor: colors.tealGreen,
    ...shadow(colors.tealGreen, 0, 2, 8, 0.12, 2),
  },
  activeBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  activeBannerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.tealGreen },
  activeBannerTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: '#065F46' },
  activeBannerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#10B981', marginTop: 2 },

  // Spacing utilities
  mt12: { marginTop: 12 },
  mt24: { marginTop: 24 },
  mt28: { marginTop: 28 },
  bottomPad: { height: 28 },
})
