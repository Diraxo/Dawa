import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop, useFocusEffect } from '@react-navigation/native'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
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

import { BookingModal } from '@/components/ui/BookingModal'
import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { QuickActionCard } from '@/components/ui/QuickActionCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

function mapDoctor(d: any): Doctor {
  return {
    id: d.id,
    name: d.users?.full_name ?? 'Dr. Unknown',
    subtitle: d.hospital_name ?? undefined,
    specialty: d.specialty ?? 'General',
    rating_average: Number(d.rating_average) ?? 0,
    review_count: d.review_count ?? 0,
    years_experience: d.years_experience ?? undefined,
    bio: d.bio ?? undefined,
    chat_price: Number(d.chat_price) ?? 0,
    phone_price: Number(d.phone_price) ?? 0,
    video_price: Number(d.video_price) ?? 0,
    is_online: d.is_online ?? false,
    profile_photo_url: d.users?.profile_photo_url ?? null,
    availability: d.availability ?? null,
    languages: d.languages ?? null,
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
  const [onlineDoctors, setOnlineDoctors] = useState<Doctor[]>([])
  const [topDoctors, setTopDoctors] = useState<Doctor[]>([])
  const [loadingDoctors, setLoadingDoctors] = useState(true)
  const [upcomingAppointment, setUpcomingAppointment] = useState<{
    doctorName: string; type: string; date: string; time: string
  } | null>(null)
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)
  const { photoUrl: dbPhotoUrl } = useOwnProfilePhoto()

  // Kept current via effect below so the realtime handler (subscribed once
  // per fetch cycle) never reads a stale closed-over value of
  // topDoctors/onlineDoctors.
  const topDoctorsRef = useRef<Doctor[]>([])
  const onlineDoctorsRef = useRef<Doctor[]>([])
  useEffect(() => { topDoctorsRef.current = topDoctors }, [topDoctors])
  useEffect(() => { onlineDoctorsRef.current = onlineDoctors }, [onlineDoctors])

  // The booking modal is handed a one-shot snapshot when opened; keep its
  // is_online AND availability (hours/blocked days/on-demand-vs-scheduled
  // toggles) in sync with realtime updates for as long as it stays open —
  // otherwise a doctor going offline, or blocking a day/changing hours,
  // while the sheet is open lets the patient book a slot that's no longer
  // actually available.
  useEffect(() => {
    if (!bookingDoctor) return
    const live = topDoctors.find(d => d.id === bookingDoctor.id) ?? onlineDoctors.find(d => d.id === bookingDoctor.id)
    if (!live) return
    if (live.is_online !== bookingDoctor.is_online || live.availability !== bookingDoctor.availability) {
      setBookingDoctor({ ...bookingDoctor, is_online: live.is_online, availability: live.availability })
    }
  }, [topDoctors, onlineDoctors, bookingDoctor])

  // Latest known realtime-derived fields per doctor. A REST fetch (initial
  // load, or the post-SUBSCRIBED reconciliation fetch below) can resolve
  // after a realtime UPDATE has already landed for a doctor — without this,
  // the fetch's setter would blindly overwrite state with a possibly-stale
  // snapshot. Every fetch result is merged through this map (realtime always
  // wins) before it reaches state.
  const realtimeKnownRef = useRef<Map<string, Partial<Pick<Doctor,
    'is_online' | 'languages' | 'availability' | 'bio' | 'specialty' | 'subtitle' |
    'years_experience' | 'chat_price' | 'phone_price' | 'video_price' | 'rating_average' | 'review_count'
  >>>>(new Map())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const mergeKnownRealtime = (docs: Doctor[]): Doctor[] =>
    docs.map(d => {
      const known = realtimeKnownRef.current.get(d.id)
      return known ? { ...d, ...known } : d
    })

  // Single merge point used by both the realtime handler and every fetch
  // result so a doctor's fields are only ever patched, never blindly replaced.
  const applyDoctorUpdate = (
    list: Doctor[],
    doctorId: string,
    patch: Partial<Doctor>
  ): Doctor[] => list.map(d => (d.id === doctorId ? { ...d, ...patch } : d))

  useEffect(() => {
    if (!user) return
    let mounted = true
    setLoadingDoctors(true)

    const CHANNEL_NAME = 'patient-home-doctor-status'

    const fetchDoctorLists = async () => {
      // Public doctor data — no auth required
      const [onlineRes, topRes] = await Promise.all([
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
      ])

      if (!mounted) return
      if (onlineRes.data) setOnlineDoctors(mergeKnownRealtime(onlineRes.data.map(mapDoctor)))
      if (topRes.data) setTopDoctors(mergeKnownRealtime(topRes.data.map(mapDoctor)))
      setLoadingDoctors(false)
    }

    ;(async () => {
      // Fetch first, subscribe after — joining the realtime channel
      // concurrently with this REST fetch let UPDATE events land in the
      // join-latency window (silently dropped, never queued/redelivered),
      // and let this fetch's callback clobber realtime state that had
      // already been applied by an event that beat it back. The
      // reconciliation fetch triggered on SUBSCRIBED below closes the
      // join-latency-window gap.
      await fetchDoctorLists()
      if (!mounted) return

      // Upcoming appointment — requires patient's Supabase UUID for explicit filtering
      const token = await getToken()
      if (!token || !mounted) return
      const client = getAuthClient(token)
      const { data: me } = await client.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
      if (!me || !mounted) return

      const apptRes = await client
        .from('consultations')
        .select('id, type, scheduled_at, doctor_profiles!inner(users!inner(full_name))')
        .eq('patient_id', (me as any).id)
        .in('status', ['pending', 'active'])
        .order('scheduled_at', { ascending: true })
        .limit(1)

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

      if (!mounted) return

      // Realtime: doctor online/offline/availability status → update lists instantly
      const existing = supabase.getChannels().find(ch => ch.topic === `realtime:${CHANNEL_NAME}`)
      if (existing) supabase.removeChannel(existing)

      const channel = supabase
        .channel(CHANNEL_NAME)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
          async (payload) => {
            const updated = payload.new as any
            if (updated.status !== 'approved') return
            const doctorId: string = updated.id
            const isNowOnline: boolean = updated.is_online
            const updatedLanguages: string[] | null | undefined = updated.languages
            const updatedAvailability: Doctor['availability'] = updated.availability ?? null
            const restPatch = {
              bio: (updated.bio ?? undefined) as string | undefined,
              specialty: (updated.specialty ?? 'General') as string,
              subtitle: (updated.hospital_name ?? undefined) as string | undefined,
              years_experience: (updated.years_experience ?? undefined) as number | undefined,
              chat_price: Number(updated.chat_price ?? 0),
              phone_price: Number(updated.phone_price ?? 0),
              video_price: Number(updated.video_price ?? 0),
              rating_average: Number(updated.rating_average ?? 0),
              review_count: (updated.review_count ?? 0) as number,
            }

            realtimeKnownRef.current.set(doctorId, {
              is_online: isNowOnline,
              languages: updatedLanguages,
              availability: updatedAvailability,
              ...restPatch,
            })

            setTopDoctors(prev => applyDoctorUpdate(prev, doctorId, {
              is_online: isNowOnline,
              languages: updatedLanguages ?? undefined,
              availability: updatedAvailability,
              ...restPatch,
            }))

            if (!isNowOnline) {
              setOnlineDoctors(prev => prev.filter(d => d.id !== doctorId))
              return
            }

            if (onlineDoctorsRef.current.some(d => d.id === doctorId)) {
              setOnlineDoctors(prev => applyDoctorUpdate(prev, doctorId, {
                is_online: true,
                languages: updatedLanguages ?? undefined,
                availability: updatedAvailability,
                ...restPatch,
              }))
              return
            }

            // Reuse the profile we already have (from topDoctors) instead of an
            // extra network round trip — a failed/slow fetch here used to mean
            // the doctor silently never reappeared as online until app restart.
            const known = topDoctorsRef.current.find(d => d.id === doctorId)
            if (known) {
              setOnlineDoctors(prev => [{ ...known, ...restPatch, is_online: true, availability: updatedAvailability ?? known.availability }, ...prev])
              return
            }

            const { data, error } = await supabase
              .from('doctor_profiles')
              .select('*, users!inner(full_name, profile_photo_url)')
              .eq('id', doctorId)
              .maybeSingle()
            if (error) {
              console.warn('[home] failed to fetch newly-online doctor profile', error)
              return
            }
            if (data) {
              setOnlineDoctors(prev =>
                prev.some(d => d.id === doctorId) ? prev : [mapDoctor(data), ...prev]
              )
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Reconcile anything that changed during the join-latency window
            // (channel handshake + auth) between the initial fetch above and
            // this channel actually reaching SUBSCRIBED.
            fetchDoctorLists()
          }
        })

      channelRef.current = channel
    })()

    return () => {
      mounted = false
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [user])

  // Tab screens stay mounted across tab switches, so the mount-only effect
  // above never sees a doctor's photo edited while this tab was in the
  // background — re-fetch both lists on every return to this tab. Realtime
  // is_online/availability state is preserved via mergeKnownRealtime.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const [onlineRes, topRes] = await Promise.all([
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
        ])
        if (cancelled) return
        if (onlineRes.data) setOnlineDoctors(mergeKnownRealtime(onlineRes.data.map(mapDoctor)))
        if (topRes.data) setTopDoctors(mergeKnownRealtime(topRes.data.map(mapDoctor)))
      })()
      return () => { cancelled = true }
    }, [])
  )

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

  const filterDoctors = (docs: Doctor[]) => {
    let result = docs
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

  const handleQuickAction = () => {
    router.push('/(patient)/(tabs)/doctors')
  }

  return (
    <>
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
            {(dbPhotoUrl ?? user?.imageUrl) ? (
              <Image source={{ uri: (dbPhotoUrl ?? user?.imageUrl) as string }} style={styles.avatar} />
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
              <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} onBook={setBookingDoctor} />
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
              <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} onBook={setBookingDoctor} />
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
    <BookingModal
      visible={bookingDoctor !== null}
      doctor={bookingDoctor}
      onClose={() => setBookingDoctor(null)}
    />
    </>
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

  // Spacing utilities
  mt12: { marginTop: 12 },
  mt24: { marginTop: 24 },
  mt28: { marginTop: 28 },
  bottomPad: { height: 28 },
})
