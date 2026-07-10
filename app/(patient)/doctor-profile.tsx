import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Image,
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
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useUserPhotoRealtime } from '@/hooks/useUserPhotoRealtime'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'


interface DoctorData {
  id: string; name: string; subtitle?: string; specialty: string
  rating_average: number; review_count: number; years_experience?: number
  bio?: string; chat_price: number; phone_price: number; video_price: number
  is_online: boolean; profile_photo_url?: string | null; userId?: string | null
  availability?: Record<string, { enabled: boolean; startTime: string; endTime: string }> | null
  languages?: string[] | null
}
interface ReviewData {
  id: string; patientName: string; rating: number; comment: string; date: string
}

export default function DoctorProfileScreen() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const CONSULT_OPTIONS = [
    { id: 'chat' as const, label: t('chat'), icon: 'chatbubble-ellipses', color: colors.tealGreen, desc: t('textBasedConsultation') },
    { id: 'phone' as const, label: t('phoneCall'), icon: 'call', color: colors.careBlue, desc: t('audioOnlyCall') },
    { id: 'video' as const, label: t('videoCall'), icon: 'videocam', color: '#7C3AED', desc: t('faceToFaceVideo') },
  ]
  const [bookingVisible, setBookingVisible] = useState(false)
  const [imageFullscreen, setImageFullscreen] = useState(false)
  const [doctor, setDoctor] = useState<DoctorData | null>(null)
  const [reviews, setReviews] = useState<ReviewData[]>([])
  const [loading, setLoading] = useState(true)
  const livePhotoUrl = useUserPhotoRealtime(doctor?.userId, doctor?.profile_photo_url)

  // Latest known realtime-derived fields for this doctor. A REST fetch
  // (initial load, or the post-SUBSCRIBED reconciliation fetch below) can
  // resolve after a realtime UPDATE has already landed — without this, the
  // fetch's setter would blindly overwrite state with a possibly-stale
  // snapshot. Every fetch result is merged through this ref (realtime always
  // wins) before it reaches state.
  const realtimeKnownRef = useRef<Partial<Pick<DoctorData,
    'is_online' | 'languages' | 'availability' | 'bio' | 'specialty' | 'subtitle' |
    'years_experience' | 'chat_price' | 'phone_price' | 'video_price' | 'rating_average' | 'review_count'
  >>>({})
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!id) return
    let mounted = true
    const CHANNEL_NAME = `patient-doctor-profile-status-${id}`
    realtimeKnownRef.current = {}

    const fetchDoctor = async () => {
      const { data: dp } = await supabase
        .from('doctor_profiles')
        .select('*, users!inner(id, full_name, profile_photo_url)')
        .eq('id', id)
        .single()
      if (!mounted) return
      if (dp) {
        setDoctor({
          id: dp.id,
          name: (dp as any).users?.full_name ?? 'Dr. Unknown',
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
          // Realtime is authoritative once received — a concurrently-resolving
          // fetch (like this one) could otherwise clobber a newer live value.
          ...realtimeKnownRef.current,
        })
      }
      setLoading(false)
    }

    ;(async () => {
      // Fired concurrently with the doctor fetch (not awaited yet) so it
      // doesn't delay first paint of the doctor's own data.
      const reviewsPromise = supabase
        .from('reviews')
        .select('id, rating, comment, created_at, patient:users!patient_id(full_name)')
        .eq('doctor_id', id)
        .order('created_at', { ascending: false })
        .limit(10)

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
        setReviews(
          rv.map((r: any) => ({
            id: r.id,
            patientName: r.patient?.full_name ?? 'Patient',
            rating: r.rating,
            comment: r.comment ?? '',
            date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          }))
        )
      }
    })()

    return () => {
      mounted = false
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [id])

  const getPrice = (type: 'chat' | 'phone' | 'video') => {
    if (!doctor) return 0
    if (type === 'chat') return doctor.chat_price
    if (type === 'phone') return doctor.phone_price
    return doctor.video_price
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
              message: `${doctor?.name ?? 'Doctor'} — ${doctor?.specialty ?? 'Specialist'} on Dawa`,
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
                <Image source={{ uri: livePhotoUrl }} style={styles.photo} />
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

          <Text style={styles.heroName}>{doctor.name}</Text>
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
                  <Text style={styles.languagePillText}>{lang}</Text>
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
            Object.entries(doctor.availability)
              .filter(([, v]) => v.enabled)
              .length === 0 ? (
              <Text style={styles.availInfoText}>No availability set</Text>
            ) : (
              Object.entries(doctor.availability)
                .filter(([, v]) => v.enabled)
                .map(([day, v]) => (
                  <View key={day} style={styles.availInfoRow}>
                    <Ionicons name="calendar-outline" size={16} color={colors.tealGreen} />
                    <Text style={styles.availInfoText}>{day}: {v.startTime} – {v.endTime}</Text>
                  </View>
                ))
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
          ) : reviews.map(review => (
            <View key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={styles.reviewAvatar}>
                  <Text style={styles.reviewAvatarText}>{review.patientName.charAt(0)}</Text>
                </View>
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
            </View>
          ))}
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
              resizeMode="contain"
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
  heroName: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, textAlign: 'center', marginBottom: 4 },
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
