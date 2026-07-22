import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

// Only medically-appropriate, telemedicine-relevant fields — no phone,
// email, address, or other contact/identifying info is ever fetched here.
interface Review {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  patientName: string
  patientPhotoUrl: string | null
  gender: string | null
  age: number | null
  consultationType: string
  consultationId: string | null
  consultationDate: string
}

function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const birth = new Date(dateOfBirth)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function StarRow({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Ionicons key={s} name={s <= rating ? 'star' : 'star-outline'} size={14} color={s <= rating ? '#F59E0B' : '#D1D5DB'} />
      ))}
    </View>
  )
}

export default function MyReviewsScreen() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  // Deep-linked from a "New Rating Received" notification (lib/notificationNav.ts)
  // — the one review tied to this consultation gets scrolled to and highlighted
  // instead of making the doctor hunt for it in the list.
  const { highlightConsultationId } = useLocalSearchParams<{ highlightConsultationId?: string }>()

  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [avgRating, setAvgRating] = useState(0)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  const scrolledToHighlightRef = useRef(false)

  // A second "New Rating Received" notification tapped while already on this
  // screen updates highlightConsultationId in place (router.setParams — see
  // lib/notificationNav.ts) rather than pushing a duplicate screen; reset the
  // one-time scroll guard so the newly-highlighted review still gets scrolled
  // to instead of only the first one ever being reached.
  useEffect(() => {
    scrolledToHighlightRef.current = false
  }, [highlightConsultationId])

  const loadReviews = async (client: ReturnType<typeof getAuthClient>, id: string) => {
    // Same medically-appropriate field set as the consultation summary's
    // patient profile card — no phone/email/address is selected.
    const { data } = await client
      .from('reviews')
      .select(`
        id, rating, comment, created_at, consultation_id,
        consultation:consultations!reviews_consultation_id_fkey(type, started_at, scheduled_at, created_at),
        patient:users!reviews_patient_id_fkey(full_name, profile_photo_url, patient_profiles(gender, date_of_birth))
      `)
      .eq('doctor_id', id)
      .eq('hidden', false)
      .order('created_at', { ascending: false })

    if (data) {
      const mapped: Review[] = (data as any[]).map((r) => {
        const patient = Array.isArray(r.patient) ? r.patient[0] : r.patient
        const detail = Array.isArray(patient?.patient_profiles) ? patient.patient_profiles[0] : patient?.patient_profiles
        const consultation = Array.isArray(r.consultation) ? r.consultation[0] : r.consultation
        return {
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.created_at,
          patientName: patient?.full_name ?? 'Patient',
          patientPhotoUrl: patient?.profile_photo_url ?? null,
          gender: detail?.gender ?? null,
          age: calculateAge(detail?.date_of_birth),
          consultationType: consultation?.type ?? 'chat',
          consultationId: r.consultation_id ?? null,
          consultationDate: consultation?.started_at ?? consultation?.scheduled_at ?? consultation?.created_at ?? r.created_at,
        }
      })
      setReviews(mapped)
    }
  }

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        // doctor_profiles SELECT RLS returns own row + every approved doctor's
        // row (for patient browsing), so this must be filtered to the caller's
        // own row or .single() throws once any other approved doctor exists.
        const { data: me } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!me) return
        const { data: profile } = await client.from('doctor_profiles').select('id, rating_average').eq('user_id', (me as any).id).single()
        if (!profile) return
        setDoctorId((profile as any).id)

        await loadReviews(client, (profile as any).id)
        // Authoritative average — same trigger-maintained column Home/Profile
        // read, so this screen's stat never disagrees with the rest of the app.
        setAvgRating(Number((profile as any).rating_average ?? 0))
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.id])

  // Live-update when a new review comes in or an existing one is
  // hidden/edited by moderation — without this the doctor only saw a new
  // rating after leaving and reopening this screen.
  useEffect(() => {
    if (!doctorId) return
    return subscribeRealtime(
      `reviews:doctor_id=eq.${doctorId}`,
      [{ event: '*', schema: 'public', table: 'reviews', filter: `doctor_id=eq.${doctorId}` }],
      async () => {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)
        await loadReviews(client, doctorId)
        const { data: profile } = await client.from('doctor_profiles').select('rating_average').eq('id', doctorId).maybeSingle()
        if (profile) setAvgRating(Number((profile as any).rating_average ?? 0))
      },
    )
  }, [doctorId, getToken])

  const typeIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
    chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam',
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>My Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tealGreen} />
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Summary card */}
          {reviews.length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryRating}>{avgRating.toFixed(1)}</Text>
              <StarRow rating={Math.round(avgRating)} />
              <Text style={styles.summaryCount}>{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</Text>
            </View>
          )}

          {reviews.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="star-outline" size={48} color={colors.steelGrey} />
              <Text style={styles.emptyTitle}>No Reviews Yet</Text>
              <Text style={styles.emptySub}>Patient reviews will appear here after consultations.</Text>
            </View>
          ) : (
            reviews.map((review) => {
              const isHighlighted = !!highlightConsultationId && review.consultationId === highlightConsultationId
              return (
                <Pressable
                  key={review.id}
                  style={({ pressed }) => [styles.reviewCard, isHighlighted && styles.reviewCardHighlighted, pressed && { opacity: 0.85 }]}
                  onPress={() => setSelectedReview(review)}
                  onLayout={(e) => {
                    if (!isHighlighted || scrolledToHighlightRef.current) return
                    scrolledToHighlightRef.current = true
                    const y = e.nativeEvent.layout.y
                    requestAnimationFrame(() => {
                      scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true })
                    })
                  }}
                >
                  <View style={styles.reviewTop}>
                    {review.patientPhotoUrl ? (
                      <Image
                        source={{ uri: review.patientPhotoUrl }}
                        style={styles.patientPhoto}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={0}
                        recyclingKey={review.patientPhotoUrl}
                      />
                    ) : (
                      <View style={styles.patientInitialWrap}>
                        <Text style={styles.patientInitial}>{review.patientName[0]?.toUpperCase() ?? 'P'}</Text>
                      </View>
                    )}
                    <View style={styles.reviewMeta}>
                      <Text style={styles.patientName}>{review.patientName}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <Ionicons name={typeIcon[review.consultationType] ?? 'chatbubble-ellipses'} size={12} color="#6B7280" />
                        <Text style={styles.reviewDate}>
                          {new Date(review.consultationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </View>
                    </View>
                    <StarRow rating={review.rating} />
                  </View>
                  {!!review.comment && (
                    <Text style={styles.reviewComment}>{review.comment}</Text>
                  )}
                </Pressable>
              )
            })
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Professional patient profile sheet — medically-appropriate info
          only, matching the consultation summary's patient card. No phone,
          email, or address is ever shown to the doctor here. */}
      <Modal visible={!!selectedReview} transparent animationType="fade" onRequestClose={() => setSelectedReview(null)}>
        <Pressable style={styles.profileBackdrop} onPress={() => setSelectedReview(null)}>
          <Pressable style={styles.profileCard} onPress={(e) => e.stopPropagation()}>
            {selectedReview && (
              <>
                <View style={styles.profileHeader}>
                  {selectedReview.patientPhotoUrl ? (
                    <Image
                      source={{ uri: selectedReview.patientPhotoUrl }}
                      style={styles.profilePhoto}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={0}
                      recyclingKey={selectedReview.patientPhotoUrl}
                    />
                  ) : (
                    <View style={styles.profilePhotoFallback}>
                      <Text style={styles.profilePhotoFallbackText}>{selectedReview.patientName[0]?.toUpperCase() ?? 'P'}</Text>
                    </View>
                  )}
                  <Text style={styles.profileName}>{selectedReview.patientName}</Text>
                  <Text style={styles.profileMeta}>
                    {[selectedReview.gender, selectedReview.age != null ? `${selectedReview.age} yrs` : null]
                      .filter(Boolean).join(' · ') || 'No demographic info on file'}
                  </Text>
                </View>

                <View style={styles.profileDivider} />

                <View style={styles.profileInfoRow}>
                  <Ionicons name={typeIcon[selectedReview.consultationType] ?? 'chatbubble-ellipses'} size={16} color={colors.careBlue} />
                  <Text style={styles.profileInfoText}>
                    {selectedReview.consultationType.charAt(0).toUpperCase() + selectedReview.consultationType.slice(1)} consultation
                  </Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.careBlue} />
                  <Text style={styles.profileInfoText}>
                    {new Date(selectedReview.consultationDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <StarRow rating={selectedReview.rating} />
                </View>
                {!!selectedReview.comment && (
                  <Text style={[styles.reviewComment, { marginTop: 4 }]}>{selectedReview.comment}</Text>
                )}

                <Pressable style={styles.profileCloseBtn} onPress={() => setSelectedReview(null)}>
                  <Text style={styles.profileCloseBtnText}>Close</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  summaryCard: {
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 20,
    alignItems: 'center', gap: 8, marginBottom: 16,
    ...shadow('#000', 0, 1, 6, 0.06, 2),
  },
  summaryRating: { fontFamily: fonts.bold, fontSize: 48, color: colors.inkBlack, lineHeight: 52 },
  summaryCount: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280' },

  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.inkBlack },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },

  reviewCard: {
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 12,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  reviewCardHighlighted: {
    borderWidth: 2, borderColor: colors.tealGreen, backgroundColor: '#F0FDFA',
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  patientInitialWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center' },
  patientInitial: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  patientPhoto: { width: 40, height: 40, borderRadius: 20 },
  reviewMeta: { flex: 1 },
  patientName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  reviewDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewComment: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 20, backgroundColor: colors.cloudGrey, borderRadius: 10, padding: 12 },

  profileBackdrop: { flex: 1, backgroundColor: 'rgba(7, 14, 39, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  profileCard: {
    backgroundColor: colors.mistWhite, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360,
    ...shadow('#000', 0, 8, 24, 0.18, 20),
  },
  profileHeader: { alignItems: 'center', gap: 6, marginBottom: 4 },
  profilePhoto: { width: 72, height: 72, borderRadius: 36, marginBottom: 8 },
  profilePhotoFallback: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  profilePhotoFallbackText: { fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite },
  profileName: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  profileMeta: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280' },
  profileDivider: { height: 1, backgroundColor: colors.steelGrey, opacity: 0.5, marginVertical: 16 },
  profileInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  profileInfoText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
  profileCloseBtn: { marginTop: 16, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: colors.steelGrey, alignItems: 'center', justifyContent: 'center' },
  profileCloseBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
})
