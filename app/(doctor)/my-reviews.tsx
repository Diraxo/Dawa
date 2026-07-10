import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

interface Review {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  patientName: string
  consultationType: string
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

  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [avgRating, setAvgRating] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: profile } = await client.from('doctor_profiles').select('id, rating_average').single()
        if (!profile) return
        const doctorId = (profile as any).id

        const { data } = await client
          .from('reviews')
          .select(`
            id, rating, comment, created_at,
            consultation:consultations!reviews_consultation_id_fkey(type),
            patient:users!reviews_patient_id_fkey(full_name)
          `)
          .eq('doctor_id', doctorId)
          .eq('hidden', false)
          .order('created_at', { ascending: false })

        if (data) {
          const mapped: Review[] = (data as any[]).map((r) => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.created_at,
            patientName: r.patient?.full_name ?? 'Patient',
            consultationType: r.consultation?.type ?? 'chat',
          }))
          setReviews(mapped)
        }
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
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
            reviews.map((review) => (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <View style={styles.patientInitialWrap}>
                    <Text style={styles.patientInitial}>{review.patientName[0]?.toUpperCase() ?? 'P'}</Text>
                  </View>
                  <View style={styles.reviewMeta}>
                    <Text style={styles.patientName}>{review.patientName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Ionicons name={typeIcon[review.consultationType] ?? 'chatbubble-ellipses'} size={12} color="#6B7280" />
                      <Text style={styles.reviewDate}>
                        {new Date(review.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <StarRow rating={review.rating} />
                </View>
                {!!review.comment && (
                  <Text style={styles.reviewComment}>{review.comment}</Text>
                )}
              </View>
            ))
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
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
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  patientInitialWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center' },
  patientInitial: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  reviewMeta: { flex: 1 },
  patientName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  reviewDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewComment: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 20, backgroundColor: colors.cloudGrey, borderRadius: 10, padding: 12 },
})
