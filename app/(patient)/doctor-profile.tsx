import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BookingModal } from '@/components/ui/BookingModal'
import { VerifiedBadge } from '@/components/ui/VerifiedBadge'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { capitalizeLanguage } from '@/lib/languageFormat'
import { formatDoctorName, normalizeNameCase } from '@/lib/nameFormat'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'


// Postgres jsonb doesn't preserve original key-insertion order — it's
// undefined here, not Mon-first (day 0 in the underlying availability jsonb
// is 'Sun', but jsonb reorders keys internally regardless). Iterating with
// Object.entries() directly made the weekly-availability list's day order
// drift between edits; always walk this fixed order instead.
const WEEK_DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

interface DoctorData {
  id: string; name: string; subtitle?: string; specialty: string
  rating_average: number; review_count: number; years_experience?: number
  bio?: string; chat_price: number; phone_price: number; video_price: number
  is_online: boolean; profile_photo_url?: string | null; userId?: string | null
  availability?: Record<string, { enabled: boolean; startTime: string; endTime: string }> | null
  languages?: string[] | null
  status?: string | null
}
interface ReviewData {
  id: string; patientName: string; patientPhotoUrl: string | null
  rating: number; comment: string; date: string; consultationType: string | null
}

const REVIEWS_PAGE_SIZE = 5

function mapReviewRow(r: any): ReviewData {
  return {
    id: r.id,
    patientName: r.patient_name ?? 'Former Patient',
    patientPhotoUrl: r.patient_photo_url ?? null,
    rating: r.rating,
    comment: r.comment ?? '',
    date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    consultationType: r.consultation_type ?? null,
  }
}

export default function DoctorProfileScreen() {
  const { t } = useTranslation()
  const { id, autoBook, consultationType } = useLocalSearchParams<{
    id: string
    // Set by the waiting-room screen when a consultation was just
    // cancelled/declined — jumps straight into the booking sheet (at the
    // date/time step, same consultation type) instead of leaving the patient
    // to find and tap "Book Appointment" on this profile themselves.
    autoBook?: string
    consultationType?: string
  }>()
  const router = useRouter()

  const CONSULT_OPTIONS = [
    { id: 'chat' as const, label: t('chat'), icon: 'chatbubble-ellipses', color: colors.tealGreen, desc: t('textBasedConsultation') },
    { id: 'phone' as const, label: t('phoneCall'), icon: 'call', color: colors.careBlue, desc: t('audioOnlyCall') },
    { id: 'video' as const, label: t('videoCall'), icon: 'videocam', color: '#7C3AED', desc: t('faceToFaceVideo') },
  ]
  const [bookingVisible, setBookingVisible] = useState(false)
  const autoBookedRef = useRef(false)
  const [imageFullscreen, setImageFullscreen] = useState(false)
  const [doctor, setDoctor] = useState<DoctorData | null>(null)
  const [reviews, setReviews] = useState<ReviewData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const hasLoadedOnceRef = useRef(false)
  const [reviewsOffset, setReviewsOffset] = useState(0)
  const [hasMoreReviews, setHasMoreReviews] = useState(true)
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false)
  // Doctor renaming mid-view was previously invisible here — only photo was
  // kept live (via a `users` subscription), name was set once in fetchDoctor
  // and never revisited.
  const { name: liveName, photoUrl: livePhotoUrl } = useUserProfileRealtime(doctor?.userId, doctor?.name, doctor?.profile_photo_url)
  const displayName = formatDoctorName(normalizeNameCase(liveName ?? doctor?.name), 'Doctor')

  // Latest known realtime-derived fields for this doctor. A REST fetch
  // (initial load, or the post-SUBSCRIBED reconciliation fetch below) can
  // resolve after a realtime UPDATE has already landed — without this, the
  // fetch's setter would blindly overwrite state with a possibly-stale
  // snapshot. Every fetch result is merged through this ref (realtime always
  // wins) before it reaches state.
  const realtimeKnownRef = useRef<Partial<Pick<DoctorData,
    'is_online' | 'languages' | 'availability' | 'bio' | 'specialty' | 'subtitle' |
    'years_experience' | 'chat_price' | 'phone_price' | 'video_price' | 'rating_average' | 'review_count' | 'status'
  >>>({})
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!id) return
    let mounted = true
    // Suffixed with Date.now() because `supabase.channel()` dedupes by topic
    // string and returns any existing channel for the same topic — if a
    // prior mount's `removeChannel()` (async unsubscribe, then teardown)
    // hasn't finished when this effect re-runs (e.g. two stack instances of
    // the same doctor's profile mounted at once), we'd otherwise get handed
    // back the old, already-subscribed channel and `.on()` would throw
    // ("cannot add postgres_changes callbacks ... after subscribe()").
    const CHANNEL_NAME = `patient-doctor-profile-status-${id}-${Date.now()}`
    realtimeKnownRef.current = {}
    setLoading(true)
    setLoadError(false)

    const fetchDoctor = async () => {
      let dp: any = null
      try {
        const { data, error } = await supabase
          .from('doctor_profiles')
          .select('*, users!inner(id, full_name, profile_photo_url)')
          .eq('id', id)
          .single()
        if (error) throw error
        dp = data
      } catch {
        // A network failure on the post-SUBSCRIBED reconciliation fetch must
        // not blank out an already-loaded profile — only the initial load
        // (nothing shown yet) surfaces the error/retry state.
        if (mounted && !hasLoadedOnceRef.current) setLoadError(true)
        if (mounted) setLoading(false)
        return
      }
      if (!mounted) return
      if (dp) {
        hasLoadedOnceRef.current = true
        setLoadError(false)
        setDoctor({
          id: dp.id,
          name: formatDoctorName((dp as any).users?.full_name, 'Dr. Unknown'),
          subtitle: dp.hospital_name ?? undefined,
          specialty: dp.specialty ?? 'General',
          rating_average: Number(dp.rating_average) ?? 0,
          review_count: dp.review_count ?? 0,
          years_experience: dp.years_experience ?? undefined,
          bio: dp.bio ?? undefined,
          chat_price: Number(dp.chat_price) ?? 0,
          phone_price: Number(dp.phone_price) ?? 0,
          video_price: Number(dp.video_price) ?? 0,
          is_online: dp.is_online ?? false,
          profile_photo_url: (dp as any).users?.profile_photo_url ?? null,
          userId: (dp as any).users?.id ?? null,
          availability: (dp as any).availability ?? null,
          languages: (dp as any).languages ?? null,
          status: (dp as any).status ?? null,
          // Realtime is authoritative once received — a concurrently-resolving
          // fetch (like this one) could otherwise clobber a newer live value.
          ...realtimeKnownRef.current,
        })
      }
      setLoading(false)
    }

    ;(async () => {
      // Fired concurrently with the doctor fetch (not awaited yet) so it
      // doesn't delay first paint of the doctor's own data. Uses the
      // get_doctor_reviews RPC (one review per patient — their latest —
      // with a live-joined current name/photo bypassing users RLS) rather
      // than querying `reviews` directly.
      const reviewsPromise = supabase.rpc('get_doctor_reviews', {
        p_doctor_id: id,
        p_limit: REVIEWS_PAGE_SIZE,
        p_offset: 0,
      })

      // Fetch the doctor first, subscribe after — joining the realtime
      // channel concurrently with this REST fetch let UPDATE events land in
      // the join-latency window (silently dropped, never queued/
      // redelivered), and let this fetch's callback clobber realtime state
      // that had already been applied by an event that beat it back. The
      // reconciliation fetch triggered on SUBSCRIBED below closes the
      // join-latency-window gap.
      await fetchDoctor()
      if (!mounted) return

      // Realtime: this doctor's online/offline/availability status → badge + Book CTA update live
      const channel = supabase
        .channel(CHANNEL_NAME)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${id}` },
          (payload) => {
            const updated = payload.new as any
            const patch = {
              is_online: (updated.is_online ?? false) as boolean,
              languages: (updated.languages ?? undefined) as string[] | null | undefined,
              availability: (updated.availability ?? null) as DoctorData['availability'],
              bio: (updated.bio ?? undefined) as string | undefined,
              specialty: (updated.specialty ?? undefined) as string | undefined,
              subtitle: (updated.hospital_name ?? undefined) as string | undefined,
              years_experience: (updated.years_experience ?? undefined) as number | undefined,
              chat_price: Number(updated.chat_price ?? 0),
              phone_price: Number(updated.phone_price ?? 0),
              video_price: Number(updated.video_price ?? 0),
              rating_average: Number(updated.rating_average ?? 0),
              review_count: (updated.review_count ?? 0) as number,
              status: (updated.status ?? null) as string | null,
            }
            realtimeKnownRef.current = patch
            setDoctor(prev => prev ? {
              ...prev,
              is_online: patch.is_online,
              languages: patch.languages ?? prev.languages,
              availability: patch.availability ?? prev.availability,
              bio: patch.bio ?? prev.bio,
              specialty: patch.specialty ?? prev.specialty,
              subtitle: patch.subtitle ?? prev.subtitle,
              years_experience: patch.years_experience ?? prev.years_experience,
              chat_price: patch.chat_price,
              phone_price: patch.phone_price,
              video_price: patch.video_price,
              rating_average: patch.rating_average,
              review_count: patch.review_count,
              status: patch.status ?? prev.status,
            } : prev)
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Reconcile anything that changed during the join-latency window
            // (channel handshake + auth) between the initial fetch above and
            // this channel actually reaching SUBSCRIBED.
            fetchDoctor()
          }
        })

      channelRef.current = channel

      const { data: rv } = await reviewsPromise
      if (!mounted) return
      if (rv) {
        setReviews(rv.map(mapReviewRow))
        setHasMoreReviews(rv.length === REVIEWS_PAGE_SIZE)
        setReviewsOffset(rv.length)
      }
    })()

    return () => {
      mounted = false
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [id, retryTick])

  useEffect(() => {
    if (doctor && autoBook === '1' && !autoBookedRef.current) {
      autoBookedRef.current = true
      setBookingVisible(true)
    }
  }, [doctor, autoBook])

  const getPrice = (type: 'chat' | 'phone' | 'video') => {
    if (!doctor) return 0
    if (type === 'chat') return doctor.chat_price
    if (type === 'phone') return doctor.phone_price
    return doctor.video_price
  }

  const loadMoreReviews = async () => {
    if (!id || loadingMoreReviews || !hasMoreReviews) return
    setLoadingMoreReviews(true)
    const { data } = await supabase.rpc('get_doctor_reviews', {
      p_doctor_id: id,
      p_limit: REVIEWS_PAGE_SIZE,
      p_offset: reviewsOffset,
    })
    if (data) {
      setReviews(prev => [...prev, ...data.map(mapReviewRow)])
      setHasMoreReviews(data.length === REVIEWS_PAGE_SIZE)
      setReviewsOffset(prev => prev + data.length)
    }
    setLoadingMoreReviews(false)
  }

  if (loadError && !doctor) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.steelGrey} style={{ marginBottom: 12 }} />
          <Text style={{ fontFamily: fonts.medium, color: colors.inkBlack, fontSize: 15, textAlign: 'center', marginBottom: 16 }}>
            Could not load this profile. Check your connection and try again.
          </Text>
          <Pressable
            onPress={() => { setLoadError(false); setLoading(true); setRetryTick((n) => n + 1) }}
            style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.tealGreen }}
          >
            <Text style={{ fontFamily: fonts.semiBold, color: '#FFFFFF', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (loading || !doctor) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.regular, color: '#6B7280' }}>{t('loading')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top nav */}
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.navTitle}>{t('doctorProfile')}</Text>
        <Pressable
          style={styles.shareBtn}
          onPress={() =>
            Share.share({
              message: `${displayName} — ${doctor?.specialty ?? 'Specialist'} on Dawa`,
            })
          }
        >
          <Ionicons name="share-outline" size={22} color={colors.inkBlack} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Hero section ── */}
        <LinearGradient
          colors={['#EFF6FF', '#F0FDFB']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.photoWrap}>
            {livePhotoUrl ? (
              <Pressable onPress={() => setImageFullscreen(true)}>
                <Image
                  source={{ uri: livePhotoUrl }}
                  style={styles.photo}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                  recyclingKey={livePhotoUrl}
                />
              </Pressable>
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="person" size={52} color={colors.steelGrey} />
              </View>
            )}
            {doctor.is_online && (
              <View style={styles.onlineBadge}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>{t('online')}</Text>
              </View>
            )}
          </View>

          <View style={styles.heroNameRow}>
            <Text style={styles.heroName}>{displayName}</Text>
            {doctor.status === 'approved' && <VerifiedBadge size={18} />}
          </View>
          <Text style={styles.heroSpecialty}>{doctor.specialty}</Text>
          {doctor.subtitle ? (
            <View style={styles.hospitalRow}>
              <Ionicons name="business-outline" size={14} color="#6B7280" />
              <Text style={styles.hospitalText}>{doctor.subtitle}</Text>
            </View>
          ) : null}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Ionicons name="star" size={16} color={colors.warning} />
              <Text style={styles.statValue}>{doctor.rating_average.toFixed(1)}</Text>
              <Text style={styles.statLabel}>{t('rating')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="people-outline" size={16} color={colors.tealGreen} />
              <Text style={styles.statValue}>{doctor.review_count}</Text>
              <Text style={styles.statLabel}>{t('reviews')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="time-outline" size={16} color={colors.careBlue} />
              <Text style={styles.statValue}>{doctor.years_experience ?? '—'}</Text>
              <Text style={styles.statLabel}>{t('yrsExp')}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── About ── */}
        {doctor.bio ? (
          <Section title={t('about')}>
            <Text style={styles.bioText}>{doctor.bio}</Text>
          </Section>
        ) : null}

        {/* ── Languages ── */}
        {doctor.languages && doctor.languages.length > 0 ? (
          <Section title="Languages">
            <View style={styles.languagePillRow}>
              {doctor.languages.map(lang => (
                <View key={lang} style={styles.languagePill}>
                  <Text style={styles.languagePillText}>{capitalizeLanguage(lang)}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {/* ── Consultation Options ── */}
        <Section title={t('consultationOptions')}>
          {CONSULT_OPTIONS.map(opt => (
            <View key={opt.id} style={styles.consultCard}>
              <View style={[styles.consultIconWrap, { backgroundColor: `${opt.color}18` }]}>
                <Ionicons name={opt.icon as any} size={24} color={opt.color} />
              </View>
              <View style={styles.consultInfo}>
                <Text style={styles.consultLabel}>{opt.label}</Text>
                <Text style={styles.consultDesc}>{opt.desc}</Text>
              </View>
              <Text style={styles.consultPrice}>ETB {getPrice(opt.id)}</Text>
            </View>
          ))}
        </Section>

        {/* ── Availability ── */}
        <Section title={t('weeklyAvailability')}>
          {doctor?.availability ? (
            WEEK_DAY_ORDER
              .filter(day => (doctor.availability as any)?.[day]?.enabled)
              .length === 0 ? (
              <Text style={styles.availInfoText}>No availability set</Text>
            ) : (
              WEEK_DAY_ORDER
                .filter(day => (doctor.availability as any)?.[day]?.enabled)
                .map(day => {
                  const v = (doctor.availability as any)[day]
                  return (
                    <View key={day} style={styles.availInfoRow}>
                      <Ionicons name="calendar-outline" size={16} color={colors.tealGreen} />
                      <Text style={styles.availInfoText}>{day}: {v.startTime} – {v.endTime}</Text>
                    </View>
                  )
                })
            )
          ) : (
            <View style={styles.availInfoRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.tealGreen} />
              <Text style={styles.availInfoText}>Contact doctor to schedule</Text>
            </View>
          )}
          <Text style={styles.availNote}>{t('availableHoursNote')}</Text>
        </Section>

        {/* ── Reviews ── */}
        <Section title={`${t('patientReviews')} (${reviews.length})`}>
          {reviews.length === 0 ? (
            <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF' }}>
              {t('noReviewsYet')}
            </Text>
          ) : (
            <>
              {reviews.map(review => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    {review.patientPhotoUrl ? (
                      <Image
                        source={{ uri: review.patientPhotoUrl }}
                        style={styles.reviewAvatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={0}
                        recyclingKey={review.patientPhotoUrl}
                      />
                    ) : (
                      <View style={styles.reviewAvatar}>
                        <Text style={styles.reviewAvatarText}>{review.patientName.charAt(0)}</Text>
                      </View>
                    )}
                    <View style={styles.reviewMeta}>
                      <Text style={styles.reviewName}>{review.patientName}</Text>
                      <View style={styles.starsRow}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Ionicons key={i} name="star" size={12} color={i < review.rating ? colors.warning : colors.steelGrey} />
                        ))}
                        <Text style={styles.reviewDate}>{review.date}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.reviewComment}>{review.comment}</Text>
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={12} color={colors.tealGreen} />
                    <Text style={styles.verifiedBadgeText}>{t('verifiedConsultation')}</Text>
                  </View>
                </View>
              ))}
              {hasMoreReviews && (
                <Pressable
                  style={({ pressed }) => [styles.showMoreBtn, pressed && { opacity: 0.7 }]}
                  onPress={loadMoreReviews}
                  disabled={loadingMoreReviews}
                >
                  {loadingMoreReviews ? (
                    <ActivityIndicator size="small" color={colors.careBlue} />
                  ) : (
                    <Text style={styles.showMoreBtnText}>{t('showMoreReviews')}</Text>
                  )}
                </Pressable>
              )}
            </>
          )}
        </Section>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Fixed bottom CTA */}
      <View style={styles.bottomBar}>
        <Pressable
          style={({ pressed }) => [styles.bookBtnWrap, pressed && { opacity: 0.88 }]}
          onPress={() => setBookingVisible(true)}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.bookBtn}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.mistWhite} />
            <Text style={styles.bookBtnText}>{t('bookConsultation')}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <BookingModal
        visible={bookingVisible}
        doctor={doctor as any}
        onClose={() => setBookingVisible(false)}
        initialStep={autoBook === '1' ? 2 : 1}
        initialConsultType={(consultationType as 'chat' | 'phone' | 'video' | undefined) ?? 'chat'}
      />

      {/* Fullscreen image viewer */}
      <Modal
        visible={imageFullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setImageFullscreen(false)}
      >
        <View style={styles.fsOverlay}>
          <Pressable
            style={styles.fsCloseBtn}
            onPress={() => setImageFullscreen(false)}
          >
            <Ionicons name="close" size={28} color={colors.mistWhite} />
          </Pressable>
          {livePhotoUrl && (
            <Image
              source={{ uri: livePhotoUrl }}
              style={styles.fsImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={livePhotoUrl}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.section}>
      <Text style={sectionStyles.title}>{title}</Text>
      {children}
    </View>
  )
}

const sectionStyles = StyleSheet.create({
  section: { marginHorizontal: 20, marginBottom: 24 },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 14 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },

  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack },
  shareBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingTop: 0 },

  // Hero
  hero: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, marginBottom: 24 },
  photoWrap: { position: 'relative', marginBottom: 14 },
  photo: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: colors.mistWhite },
  photoPlaceholder: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.mistWhite,
  },
  onlineBadge: {
    position: 'absolute', bottom: 4, right: -4,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.mistWhite, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4,
    ...shadow('#000', 0, 1, 4, 0.1, 2),
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.success },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 },
  heroName: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, textAlign: 'center' },
  heroSpecialty: { fontFamily: fonts.medium, fontSize: 15, color: colors.tealGreen, textAlign: 'center', marginBottom: 6 },
  hospitalRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 18 },
  hospitalText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  stat: { alignItems: 'center', gap: 4 },
  statValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  statLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  statDivider: { width: 1, height: 36, backgroundColor: colors.steelGrey },

  bioText: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 22 },
  languagePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  languagePill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: `${colors.tealGreen}18`, borderWidth: 1, borderColor: `${colors.tealGreen}33`,
  },
  languagePillText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.tealGreen },

  // Consult options
  consultCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 14, marginBottom: 10,
  },
  consultIconWrap: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  consultInfo: { flex: 1 },
  consultLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  consultDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  consultPrice: { fontFamily: fonts.bold, fontSize: 15, color: colors.careBlue },

  // Availability
  availInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  availInfoText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  availNote: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 10, textAlign: 'center' },

  // Reviews
  reviewCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.cloudGrey, padding: 14, marginBottom: 10 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  reviewAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.careBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewAvatarText: { fontFamily: fonts.bold, fontSize: 14, color: colors.mistWhite },
  reviewMeta: { flex: 1 },
  reviewName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  reviewDate: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginLeft: 6 },
  reviewComment: { fontFamily: fonts.regular, fontSize: 13, color: '#374151', lineHeight: 20 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  verifiedBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.tealGreen },
  showMoreBtn: {
    alignItems: 'center', justifyContent: 'center',
    height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.careBlue,
    marginTop: 4,
  },
  showMoreBtnText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.careBlue },

  // Fullscreen image
  fsOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  fsCloseBtn: {
    position: 'absolute', top: 56, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  fsImage: { width: '100%', height: '80%' },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
    backgroundColor: colors.mistWhite,
  },
  bookBtnWrap: { borderRadius: 16, overflow: 'hidden' },
  bookBtn: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16 },
  bookBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
