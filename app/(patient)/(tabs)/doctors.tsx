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
import { usePatientDoctors } from '@/hooks/usePatientDoctors'
import { computeDoctorPresence } from '@/lib/doctorPresence'
import { shadow } from '@/lib/shadow'
import { useTranslation } from 'react-i18next'

export default function DoctorsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const guardNav = useNavGuard()
  const [searchQuery, setSearchQuery] = useState('')
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)

  // Single source of truth, shared with the Home screen's "Available
  // Now"/"Top Rated" widgets — see hooks/usePatientDoctors.ts. `isLoading` is
  // only ever true before the first fetch has resolved.
  const { doctors: allDoctors, isLoading, presenceTick, refresh } = usePatientDoctors()

  // Tab screens stay mounted across tab switches, so the hook's own realtime
  // subscription (UPDATE-only) never sees a newly-approved doctor appear —
  // re-fetch on every return to this tab, same as before.
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
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
    // Available doctors first, then Away, then Offline — presence, not just
    // the raw is_online toggle, so a doctor whose heartbeat has gone stale
    // no longer outranks a genuinely available one.
    const presenceRank = { available: 0, away: 1, offline: 2 } as const
    list.sort((a, b) => presenceRank[computeDoctorPresence(a)] - presenceRank[computeDoctorPresence(b)])
    return list
  // presenceTick forces a re-sort when only the derived presence (not the
  // underlying doctors array) has changed — see hooks/usePatientDoctors.ts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, allDoctors, presenceTick])

  const handleViewProfile = guardNav((id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  })

  const ListHeader = (
    <View style={styles.headerContainer}>
      {/* Title */}
      <Text style={styles.title}>{t('findADoctor')}</Text>

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
            presence={computeDoctorPresence(item)}
            mode="list"
            onPress={handleViewProfile}
            onBook={setBookingDoctor}
          />
        )}
        extraData={presenceTick}
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
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 16 },

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
