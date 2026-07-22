import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop } from '@react-navigation/native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BookingModal } from '@/components/ui/BookingModal'
import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useNavGuard } from '@/hooks/useNavGuard'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { formatDoctorName } from '@/lib/nameFormat'
import { useTranslation } from 'react-i18next'

const DOCTORS_LIST_CACHE_KEY = 'patient-doctors-list'

function mapDoctor(d: any): Doctor {
  return {
    id: d.id,
    user_id: d.user_id,
    name: formatDoctorName(d.users?.full_name, 'Dr. Unknown'),
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
    // The query this feeds always filters status='approved' server-side —
    // every doctor mapDoctor() ever sees is already approved.
    status: 'approved',
  }
}

export default function DoctorsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const guardNav = useNavGuard()
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([])
  // True until the first fetch actually completes — without this, "No
  // doctors found" flashed on every mount before the fetch below resolved.
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)

  // Paint the last-known doctor list from disk immediately on mount.
  useEffect(() => {
    let cancelled = false
    getCachedJson<Doctor[]>(DOCTORS_LIST_CACHE_KEY).then((cached) => {
      if (cached && !cancelled) setAllDoctors(cached)
    })
    return () => { cancelled = true }
  }, [])

  // Latest known realtime-derived fields per doctor. A REST fetch (initial
  // load, or the post-SUBSCRIBED reconciliation fetch below) can resolve
  // after a realtime UPDATE has already landed for a doctor — without this,
  // the fetch's setter would blindly overwrite state with a possibly-stale
  // snapshot. Every fetch result is merged through this map (realtime always
  // wins) before it reaches state.
  const realtimeKnownRef = useRef<Map<string, Partial<Pick<Doctor,
    'is_online' | 'languages' | 'availability' | 'bio' | 'specialty' | 'subtitle' |
    'years_experience' | 'chat_price' | 'phone_price' | 'video_price' | 'rating_average' | 'review_count' |
    'name' | 'profile_photo_url'
  >>>>(new Map())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  // Mirrors `allDoctors` so the users-table realtime handler (below) can
  // resolve user_id -> doctor.id without depending on stale closure state.
  const allDoctorsRef = useRef<Doctor[]>([])

  const mergeKnownRealtime = (docs: Doctor[]): Doctor[] =>
    docs.map(d => {
      const known = realtimeKnownRef.current.get(d.id)
      return known ? { ...d, ...known } : d
    })

  useEffect(() => { allDoctorsRef.current = allDoctors }, [allDoctors])

  // Single merge point used by both the realtime handler and every fetch
  // result so a doctor's fields are only ever patched, never blindly replaced.
  const applyDoctorUpdate = (
    list: Doctor[],
    doctorId: string,
    patch: Partial<Doctor>
  ): Doctor[] => list.map(d => (d.id === doctorId ? { ...d, ...patch } : d))

  // Same idea as applyDoctorUpdate, but full_name/profile_photo_url live on
  // `users`, not `doctor_profiles` — that row's realtime payload carries
  // users.id, so matching has to go through user_id instead of doctor.id.
  const applyDoctorUpdateByUserId = (
    list: Doctor[],
    userId: string,
    patch: Partial<Doctor>
  ): Doctor[] => list.map(d => (d.user_id === userId ? { ...d, ...patch } : d))

  useEffect(() => {
    let mounted = true
    const CHANNEL_NAME = 'patient-doctors-list-status'

    const fetchDoctors = async () => {
      try {
        const { data } = await supabase
          .from('doctor_profiles')
          .select('*, users!inner(full_name, profile_photo_url)')
          .eq('status', 'approved')
          .order('rating_average', { ascending: false })
        if (!mounted) return
        if (data) {
          const next = mergeKnownRealtime(data.map(mapDoctor))
          setAllDoctors(next)
          setCachedJson(DOCTORS_LIST_CACHE_KEY, next)
        }
      } catch {
        // Network failure — leave whatever list is already on screen (cache
        // or a prior fetch); this previously escaped uncaught and left
        // isLoading stuck true forever, since the line below never ran.
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    ;(async () => {
      // Fetch first, subscribe after — joining the realtime channel
      // concurrently with this REST fetch let UPDATE events land in the
      // join-latency window (silently dropped, never queued/redelivered),
      // and let this fetch's callback clobber realtime state that had
      // already been applied by an event that beat it back. The
      // reconciliation fetch triggered on SUBSCRIBED below closes the
      // join-latency-window gap.
      await fetchDoctors()
      if (!mounted) return

      // Realtime: doctor online/offline/availability status → instantly re-sort list
      // A stale channel with this same topic can still be registered on the
      // client (removeChannel's teardown is async and may not have run yet
      // from a prior mount) — supabase.channel() would then return that
      // already-subscribed instance instead of a fresh one, and .on() below
      // would throw "cannot add postgres_changes callbacks after
      // subscribe()". Clear any leftover first to close that race.
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${CHANNEL_NAME}`)
      if (stale) supabase.removeChannel(stale)
      const channel = supabase
        .channel(CHANNEL_NAME)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
          (payload) => {
            const updated = payload.new as any
            if (updated.status !== 'approved') return
            const patch = {
              is_online: updated.is_online as boolean,
              languages: (updated.languages ?? undefined) as string[] | null | undefined,
              availability: (updated.availability ?? null) as Doctor['availability'],
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
            realtimeKnownRef.current.set(updated.id, patch)
            setAllDoctors(prev => applyDoctorUpdate(prev, updated.id, patch))
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'users' },
          (payload) => {
            const updated = payload.new as any
            const doc = allDoctorsRef.current.find(d => d.user_id === updated.id)
            if (!doc) return
            const patch = {
              name: formatDoctorName(updated.full_name, 'Dr. Unknown'),
              profile_photo_url: (updated.profile_photo_url ?? null) as string | null,
            }
            realtimeKnownRef.current.set(doc.id, { ...realtimeKnownRef.current.get(doc.id), ...patch })
            setAllDoctors(prev => applyDoctorUpdateByUserId(prev, updated.id, patch))
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Reconcile anything that changed during the join-latency window
            // (channel handshake + auth) between the initial fetch above and
            // this channel actually reaching SUBSCRIBED.
            fetchDoctors()
          }
        })

      channelRef.current = channel
    })()

    return () => {
      mounted = false
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  // Tab screens stay mounted across tab switches, so the mount-only effect
  // above never sees a photo edited while this tab was in the background —
  // re-fetch on every return to this tab. Realtime is_online/availability
  // state is preserved via mergeKnownRealtime.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const { data } = await supabase
          .from('doctor_profiles')
          .select('*, users!inner(full_name, profile_photo_url)')
          .eq('status', 'approved')
          .order('rating_average', { ascending: false })
        if (!cancelled && data) {
          const next = mergeKnownRealtime(data.map(mapDoctor))
          setAllDoctors(next)
          setCachedJson(DOCTORS_LIST_CACHE_KEY, next)
        }
      })()
      return () => { cancelled = true }
    }, [])
  )

  // The booking modal is handed a one-shot snapshot when opened; keep its
  // is_online AND availability (hours/blocked days/on-demand-vs-scheduled
  // toggles) in sync with realtime updates for as long as it stays open —
  // otherwise a doctor blocking a day or changing hours while the sheet is
  // open lets the patient book a slot that's no longer actually available.
  useEffect(() => {
    if (!bookingDoctor) return
    const live = allDoctors.find(d => d.id === bookingDoctor.id)
    if (!live) return
    if (live.is_online !== bookingDoctor.is_online || live.availability !== bookingDoctor.availability) {
      setBookingDoctor({ ...bookingDoctor, is_online: live.is_online, availability: live.availability })
    }
  }, [allDoctors, bookingDoctor])

  const filteredDoctors = useMemo(() => {
    let list = [...allDoctors]
    const q = searchQuery.toLowerCase().trim()

    if (q) {
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.specialty.toLowerCase().includes(q) ||
        d.subtitle?.toLowerCase().includes(q)
      )
    }
    // Online doctors always first
    list.sort((a, b) => (b.is_online !== a.is_online ? (b.is_online ? 1 : -1) : 0))
    return list
  }, [searchQuery, allDoctors])

  const handleViewProfile = guardNav((id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  })

  const ListHeader = (
    <View style={styles.headerContainer}>
      {/* Title */}
      <Text style={styles.title}>{t('findADoctor')}</Text>
      <Text style={styles.subtitle}>
        {filteredDoctors.length} {filteredDoctors.length === 1 ? 'doctor found' : 'doctors found'}
      </Text>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchDoctors')}
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

      {/* Sort indicator */}
      <View style={styles.sortRow}>
        <Ionicons name="radio-button-on" size={12} color={colors.success} />
        <Text style={styles.sortText}>{t('onlineDoctorsFirst')}</Text>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        ref={listRef}
        data={filteredDoctors}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <DoctorCard
            doctor={item}
            mode="list"
            onPress={handleViewProfile}
            onBook={setBookingDoctor}
          />
        )}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="small" color={colors.steelGrey} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={52} color={colors.steelGrey} />
              <Text style={styles.emptyTitle}>{t('noDoctorsFound')}</Text>
              <Text style={styles.emptySub}>{t('tryAdjustingFilters')}</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Booking bottom sheet */}
      <BookingModal
        visible={bookingDoctor !== null}
        doctor={bookingDoctor}
        onClose={() => setBookingDoctor(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },

  headerContainer: { paddingTop: 10, paddingBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 2 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', marginBottom: 16 },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.mistWhite, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  searchInput: {
    flex: 1, fontFamily: fonts.regular, fontSize: 14,
    color: colors.inkBlack, padding: 0,
  },

  // Sort
  sortRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 4,
  },
  sortText: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.inkBlack },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center' },
})
