import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop, useFocusEffect } from '@react-navigation/native'
import { useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { BookingModal } from '@/components/ui/BookingModal'
import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { QuickActionCard } from '@/components/ui/QuickActionCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { usePatientAppointments } from '@/hooks/usePatientAppointments'
import { usePatientDoctors } from '@/hooks/usePatientDoctors'
import { shadow } from '@/lib/shadow'

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
  const scrollRef = useRef<ScrollView>(null)
  useScrollToTop(scrollRef)
  const guardNav = useNavGuard()
  const [searchQuery, setSearchQuery] = useState('')
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)
  const { photoUrl: dbPhotoUrl } = useOwnProfilePhoto()

  // Sized so exactly 2 full doctor cards are visible in the Available Now /
  // Top Rated carousels on any screen width, instead of the ~1.5 cards the
  // old fixed 208pt card showed (screenWidth - 40 = scrollContent's 20pt
  // side padding × 2; - 12 = the one gap between the two visible cards).
  const { width: windowWidth } = useWindowDimensions()
  const doctorCardWidth = (windowWidth - 40 - 12) / 2

  // Single source of truth, shared with the Appointments screen's
  // Upcoming/Past tabs — see hooks/usePatientAppointments.ts. `isLoading` is
  // only ever true before the first fetch for this user has resolved, so a
  // realtime-triggered background refresh can never flip this widget back
  // into a loading/empty state once real data has been shown.
  const { upcoming, isLoading: loadingAppointment } = usePatientAppointments()
  const nextAppointment = upcoming[0] ?? null
  const upcomingAppointment = useMemo(() => {
    if (!nextAppointment) return null
    const d = new Date(nextAppointment.scheduledAt)
    return {
      doctorName: nextAppointment.doctorName,
      type: nextAppointment.type,
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    }
  }, [nextAppointment])

  // Single source of truth, shared with the Doctors tab's full list — see
  // hooks/usePatientDoctors.ts. Both widgets below are pure slices of the
  // same rating-sorted list, so they can never disagree with the Doctors tab
  // about a given doctor's live is_online/price/bio/etc.
  const { doctors: allDoctors, isLoading: loadingDoctors, refresh: refreshDoctors } = usePatientDoctors()
  const topDoctors = useMemo(() => allDoctors.slice(0, 8), [allDoctors])
  const onlineDoctors = useMemo(() => allDoctors.filter(d => d.is_online).slice(0, 8), [allDoctors])

  // The booking modal is handed a one-shot snapshot when opened; keep its
  // is_online AND availability (hours/blocked days/on-demand-vs-scheduled
  // toggles) in sync with realtime updates for as long as it stays open —
  // otherwise a doctor going offline, or blocking a day/changing hours,
  // while the sheet is open lets the patient book a slot that's no longer
  // actually available.
  useEffect(() => {
    if (!bookingDoctor) return
    const live = allDoctors.find(d => d.id === bookingDoctor.id)
    if (!live) return
    if (live.is_online !== bookingDoctor.is_online || live.availability !== bookingDoctor.availability) {
      setBookingDoctor({ ...bookingDoctor, is_online: live.is_online, availability: live.availability })
    }
  }, [allDoctors, bookingDoctor])

  // Tab screens stay mounted across tab switches, so the hook's own realtime
  // subscription (UPDATE-only) never sees a newly-approved doctor appear —
  // re-fetch on every return to this tab, same as before.
  useFocusEffect(
    useCallback(() => {
      refreshDoctors()
    }, [refreshDoctors])
  )

  const firstName =
    user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'there'

  function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return t('goodMorning')
    if (hour < 17) return t('goodAfternoon')
    return t('goodEvening')
  }

  const handleDoctorPress = guardNav((id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  })

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
              <Image
                source={{ uri: (dbPhotoUrl ?? user?.imageUrl) as string }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
              />
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
              <DoctorCard key={doc.id} doctor={doc} cardWidth={doctorCardWidth} onPress={handleDoctorPress} onBook={setBookingDoctor} />
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
              <DoctorCard key={doc.id} doctor={doc} cardWidth={doctorCardWidth} onPress={handleDoctorPress} onBook={setBookingDoctor} />
            ))}
          </ScrollView>
        )}

        {/* ── Upcoming Appointment ── */}
        <Text style={[styles.sectionTitle, styles.mt28]}>{t('upcomingAppointment')}</Text>
        {loadingAppointment && !upcomingAppointment ? (
          <View style={[styles.emptyApptCard, styles.mt12]}>
            <ActivityIndicator size="small" color={colors.steelGrey} />
          </View>
        ) : upcomingAppointment ? (
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
