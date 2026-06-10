import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BookingModal } from '@/components/ui/BookingModal'
import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { ALL_DOCTORS, SPECIALTIES } from '@/lib/mockDoctors'

const PRICE_FILTERS = [
  { label: 'Any Price', max: Infinity },
  { label: '< ETB 200', max: 200 },
  { label: '< ETB 400', max: 400 },
]

const RATING_FILTERS = [
  { label: 'Any', min: 0 },
  { label: '4.0+', min: 4.0 },
  { label: '4.5+', min: 4.5 },
  { label: '4.8+', min: 4.8 },
]

export default function DoctorsScreen() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [specialty, setSpecialty] = useState('All Specialties')
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const [availableNow, setAvailableNow] = useState(false)
  const [priceIdx, setPriceIdx] = useState(0)
  const [ratingIdx, setRatingIdx] = useState(0)
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)

  const filteredDoctors = useMemo(() => {
    let list = [...ALL_DOCTORS]
    const q = searchQuery.toLowerCase().trim()

    if (q) {
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.specialty.toLowerCase().includes(q) ||
        d.subtitle?.toLowerCase().includes(q)
      )
    }
    if (specialty !== 'All Specialties') {
      list = list.filter(d => d.specialty === specialty)
    }
    if (availableNow) {
      list = list.filter(d => d.is_online)
    }
    const minRating = RATING_FILTERS[ratingIdx].min
    if (minRating > 0) {
      list = list.filter(d => d.rating_average >= minRating)
    }
    const maxPrice = PRICE_FILTERS[priceIdx].max
    if (maxPrice < Infinity) {
      list = list.filter(d =>
        d.chat_price <= maxPrice ||
        d.phone_price <= maxPrice ||
        d.video_price <= maxPrice
      )
    }
    // Always sort by best rating
    list.sort((a, b) => b.rating_average - a.rating_average)
    return list
  }, [searchQuery, specialty, availableNow, priceIdx, ratingIdx])

  const handleViewProfile = (id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  }

  const ListHeader = (
    <View style={styles.headerContainer}>
      {/* Title */}
      <Text style={styles.title}>Find a Doctor</Text>
      <Text style={styles.subtitle}>
        {filteredDoctors.length} doctor{filteredDoctors.length !== 1 ? 's' : ''} available
      </Text>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search doctors, specialties..."
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

      {/* Specialty dropdown button */}
      <Pressable
        style={({ pressed }) => [styles.specialtyBtn, pressed && { opacity: 0.8 }]}
        onPress={() => setSpecialtyOpen(true)}
      >
        <Ionicons name="medical-outline" size={16} color={specialty === 'All Specialties' ? '#6B7280' : colors.tealGreen} />
        <Text style={[styles.specialtyBtnText, specialty !== 'All Specialties' && styles.specialtyBtnActive]}>
          {specialty}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>

      {/* Filter row */}
      <View style={styles.filterRow}>
        {/* Available Now */}
        <View style={styles.availableRow}>
          <View style={[styles.onlineDot, !availableNow && styles.onlineDotOff]} />
          <Text style={styles.filterLabel}>Available Now</Text>
          <Switch
            value={availableNow}
            onValueChange={setAvailableNow}
            trackColor={{ false: colors.steelGrey, true: colors.tealGreen }}
            thumbColor={colors.mistWhite}
            style={styles.switch}
          />
        </View>
      </View>

      {/* Rating chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        {RATING_FILTERS.map((r, idx) => (
          <Pressable
            key={r.label}
            onPress={() => setRatingIdx(idx)}
            style={[styles.chip, ratingIdx === idx && styles.chipSelected]}
          >
            {ratingIdx === idx && idx > 0 && (
              <Ionicons name="star" size={12} color={colors.mistWhite} />
            )}
            <Text style={[styles.chipText, ratingIdx === idx && styles.chipTextSelected]}>
              {r.label}
            </Text>
          </Pressable>
        ))}
        <View style={styles.chipSpacer} />
        {PRICE_FILTERS.map((p, idx) => (
          <Pressable
            key={p.label}
            onPress={() => setPriceIdx(idx)}
            style={[styles.chip, priceIdx === idx && styles.chipSelectedBlue]}
          >
            <Text style={[styles.chipText, priceIdx === idx && styles.chipTextSelected]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort indicator */}
      <View style={styles.sortRow}>
        <Ionicons name="trophy" size={14} color={colors.warning} />
        <Text style={styles.sortText}>Sorted by Best Rating</Text>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
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
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={52} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>No doctors found</Text>
            <Text style={styles.emptySub}>Try adjusting your filters or search query</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Specialty picker modal */}
      <Modal
        visible={specialtyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSpecialtyOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSpecialtyOpen(false)} />
        <View style={styles.specialtySheet}>
          <Text style={styles.sheetTitle}>Select Specialty</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {SPECIALTIES.map(s => (
              <Pressable
                key={s}
                style={[styles.specialtyOption, specialty === s && styles.specialtyOptionSelected]}
                onPress={() => { setSpecialty(s); setSpecialtyOpen(false) }}
              >
                <Text style={[styles.specialtyOptionText, specialty === s && styles.specialtyOptionTextSelected]}>
                  {s}
                </Text>
                {specialty === s && (
                  <Ionicons name="checkmark" size={18} color={colors.tealGreen} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

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
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  searchInput: {
    flex: 1, fontFamily: fonts.regular, fontSize: 14,
    color: colors.inkBlack, padding: 0,
  },

  // Specialty
  specialtyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.mistWhite, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
    borderWidth: 1.5, borderColor: colors.steelGrey,
  },
  specialtyBtnText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: '#6B7280' },
  specialtyBtnActive: { color: colors.tealGreen },

  // Filters
  filterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  availableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineDotOff: { backgroundColor: colors.steelGrey },
  filterLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkBlack },
  switch: { marginLeft: 4 },

  // Chips
  chipScroll: { marginBottom: 12 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: colors.mistWhite, borderWidth: 1.5, borderColor: colors.steelGrey,
    marginRight: 8,
  },
  chipSelected: { backgroundColor: colors.tealGreen, borderColor: colors.tealGreen },
  chipSelectedBlue: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  chipTextSelected: { color: colors.mistWhite },
  chipSpacer: { width: 1, height: 30, backgroundColor: colors.steelGrey, marginRight: 8 },

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

  // Specialty modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  specialtySheet: {
    backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, maxHeight: '60%',
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 16 },
  specialtyOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  specialtyOptionSelected: { backgroundColor: '#F0FDFB', marginHorizontal: -20, paddingHorizontal: 20 },
  specialtyOptionText: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkBlack },
  specialtyOptionTextSelected: { color: colors.tealGreen },
})
