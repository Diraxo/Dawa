import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BookingModal } from '@/components/ui/BookingModal'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { supabase } from '@/lib/supabase'

const CONSULT_OPTIONS = [
  { id: 'chat' as const, label: 'Chat', icon: 'chatbubble-ellipses', color: colors.tealGreen, desc: 'Text-based consultation' },
  { id: 'phone' as const, label: 'Phone Call', icon: 'call', color: colors.careBlue, desc: 'Audio-only call' },
  { id: 'video' as const, label: 'Video Call', icon: 'videocam', color: '#7C3AED', desc: 'Face-to-face video call' },
]

const AVAILABILITY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const AVAILABLE_DAYS = [0, 1, 2, 3, 4] // Mon–Fri by default

interface DoctorData {
  id: string; name: string; subtitle?: string; specialty: string
  rating_average: number; review_count: number; years_experience?: number
  bio?: string; chat_price: number; phone_price: number; video_price: number
  is_online: boolean; profile_photo_url?: string | null
}
interface ReviewData {
  id: string; patientName: string; rating: number; comment: string; date: string
}

export default function DoctorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [bookingVisible, setBookingVisible] = useState(false)
  const [doctor, setDoctor] = useState<DoctorData | null>(null)
  const [reviews, setReviews] = useState<ReviewData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase
        .from('doctor_profiles')
        .select('*, users!inner(id, full_name, profile_photo_url)')
        .eq('id', id)
        .single(),
      supabase
        .from('reviews')
        .select('*, patient:patient_id(full_name)')
        .order('created_at', { ascending: false })
        .limit(10),
    ]).then(([{ data: dp }, { data: rv }]) => {
      if (dp) {
        setDoctor({
          id: dp.id,
          name: (dp as any).users?.full_name ?? 'Dr. Unknown',
          subtitle: dp.hospital_name ?? undefined,
          specialty: dp.specialty ?? 'General',
          rating_average: Number(dp.rating_average) ?? 0,
          review_count: dp.total_consultations ?? 0,
          years_experience: dp.years_experience ?? undefined,
          bio: dp.bio ?? undefined,
          chat_price: Number(dp.chat_price) ?? 0,
          phone_price: Number(dp.phone_price) ?? 0,
          video_price: Number(dp.video_price) ?? 0,
          is_online: dp.is_online ?? false,
          profile_photo_url: (dp as any).users?.profile_photo_url ?? null,
        })
        // Filter reviews for this doctor using their user_id
        const userId = (dp as any).users?.id
        if (rv && userId) {
          setReviews(
            rv
              .filter((r: any) => r.doctor_id === userId)
              .map((r: any) => ({
                id: r.id,
                patientName: r.patient?.full_name ?? 'Patient',
                rating: r.rating,
                comment: r.comment ?? '',
                date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              }))
          )
        }
      }
      setLoading(false)
    })
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
          <Text style={{ fontFamily: fonts.regular, color: '#6B7280' }}>Loading...</Text>
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
        <Text style={styles.navTitle}>Doctor Profile</Text>
        <Pressable style={styles.shareBtn}>
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
            {doctor.profile_photo_url ? (
              <Image source={{ uri: doctor.profile_photo_url }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="person" size={52} color={colors.steelGrey} />
              </View>
            )}
            {doctor.is_online && (
              <View style={styles.onlineBadge}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>Online</Text>
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
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="people-outline" size={16} color={colors.tealGreen} />
              <Text style={styles.statValue}>{doctor.review_count}</Text>
              <Text style={styles.statLabel}>Reviews</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="time-outline" size={16} color={colors.careBlue} />
              <Text style={styles.statValue}>{doctor.years_experience ?? '—'}</Text>
              <Text style={styles.statLabel}>Yrs Exp</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── About ── */}
        {doctor.bio ? (
          <Section title="About">
            <Text style={styles.bioText}>{doctor.bio}</Text>
          </Section>
        ) : null}

        {/* ── Consultation Options ── */}
        <Section title="Consultation Options">
          {CONSULT_OPTIONS.map(opt => (
            <View key={opt.id} style={styles.consultCard}>
              <View style={[styles.consultIconWrap, { backgroundColor: `${opt.color}18` }]}>
                <Ionicons name={opt.icon as any} size={22} color={opt.color} />
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
        <Section title="Weekly Availability">
          <View style={styles.availRow}>
            {AVAILABILITY.map((day, idx) => (
              <View key={day} style={styles.dayWrap}>
                <View style={[styles.dayCircle, AVAILABLE_DAYS.includes(idx) && styles.dayCircleActive]}>
                  <Text style={[styles.dayText, AVAILABLE_DAYS.includes(idx) && styles.dayTextActive]}>
                    {day}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.availNote}>Available 9:00 AM – 5:00 PM on marked days</Text>
        </Section>

        {/* ── Reviews ── */}
        <Section title={`Patient Reviews (${reviews.length})`}>
          {reviews.length === 0 ? (
            <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF' }}>
              No reviews yet.
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
            <Text style={styles.bookBtnText}>Book Consultation</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <BookingModal
        visible={bookingVisible}
        doctor={doctor as any}
        onClose={() => setBookingVisible(false)}
      />
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
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 2,
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

  // Consult options
  consultCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 14, marginBottom: 10,
  },
  consultIconWrap: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  consultInfo: { flex: 1 },
  consultLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  consultDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  consultPrice: { fontFamily: fonts.bold, fontSize: 15, color: colors.careBlue },

  // Availability
  availRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayWrap: { alignItems: 'center' },
  dayCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCircleActive: { backgroundColor: colors.tealGreen },
  dayText: { fontFamily: fonts.semiBold, fontSize: 11, color: '#9CA3AF' },
  dayTextActive: { color: colors.mistWhite },
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
