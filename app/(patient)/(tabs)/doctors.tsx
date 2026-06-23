import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
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
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'

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

function mapDoctor(d: any): Doctor {
  return {
    id: d.id,
    name: d.users?.full_name ?? 'Dr. Unknown',
    subtitle: d.hospital_name ?? undefined,
    specialty: d.specialty ?? 'General',
    rating_average: Number(d.rating_average) ?? 0,
    review_count: d.total_consultations ?? 0,
    years_experience: d.years_experience ?? undefined,
    bio: d.bio ?? undefined,
    chat_price: Number(d.chat_price) ?? 0,
    phone_price: Number(d.phone_price) ?? 0,
    video_price: Number(d.video_price) ?? 0,
    is_online: d.is_online ?? false,
    profile_photo_url: d.users?.profile_photo_url ?? null,
    availability: d.availability ?? null,
  }
}

export default function DoctorsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([])
  const [specialties, setSpecialties] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const [priceIdx, setPriceIdx] = useState(0)
  const [ratingIdx, setRatingIdx] = useState(0)
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null)

  useEffect(() => {
    Promise.all([
      supabase
        .from('doctor_profiles')
        .select('*, users!inner(full_name, profile_photo_url)')
        .eq('status', 'approved')
        .order('rating_average', { ascending: false }),
      supabase.from('specialties').select('name').order('name'),
      supabase.from('doctor_profiles').select('specialty').eq('status', 'approved').not('specialty', 'is', null),
    ]).then(([doctorsRes, adminSpecsRes, usedSpecsRes]) => {
      if (doctorsRes.data) setAllDoctors(doctorsRes.data.map(mapDoctor))

      // Only show specialty chips that exist in the admin table AND have ≥1 approved doctor
      const adminSet = new Set((adminSpecsRes.data ?? []).map((s: any) => s.name as string))
      const withDoctors = [...new Set(
        (usedSpecsRes.data ?? []).map((d: any) => d.specialty as string).filter(Boolean)
      )].filter(s => adminSet.has(s)).sort() as string[]
      if (withDoctors.length) setSpecialties(withDoctors)
    })
  }, [])

  // Realtime: doctor online/offline status → instantly re-sort list
  useEffect(() => {
    const channel = supabase
      .channel('patient-doctors-list-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
        (payload) => {
          const updated = payload.new as any
          if (updated.status !== 'approved') return
          setAllDoctors(prev =>
            prev.map(d => d.id === updated.id ? { ...d, is_online: updated.is_online } : d)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

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
    if (specialty) {
      list = list.filter(d => d.specialty === specialty)
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
    // Online doctors always first, then by best rating
    list.sort((a, b) => {
      if (b.is_online !== a.is_online) return b.is_online ? 1 : -1
      return b.rating_average - a.rating_average
    })
    return list
  }, [searchQuery, specialty, priceIdx, ratingIdx])

  const handleViewProfile = (id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  }

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

      {/* Specialty dropdown button */}
      <Pressable
        style={({ pressed }) => [styles.specialtyBtn, pressed && { opacity: 0.8 }]}
        onPress={() => setSpecialtyOpen(true)}
      >
        <Ionicons name="medical-outline" size={16} color={specialty === '' ? '#6B7280' : colors.tealGreen} />
        <Text style={[styles.specialtyBtnText, specialty !== '' && styles.specialtyBtnActive]}>
          {specialty || t('allSpecialties')}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>

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
        <Text style={styles.sortText}>{t('sortedByBestRating')}</Text>
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
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={52} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>{t('noDoctorsFound')}</Text>
            <Text style={styles.emptySub}>{t('tryAdjustingFilters')}</Text>
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
          <Text style={styles.sheetTitle}>{t('selectSpecialty')}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable
              style={[styles.specialtyOption, specialty === '' && styles.specialtyOptionSelected]}
              onPress={() => { setSpecialty(''); setSpecialtyOpen(false) }}
            >
              <Text style={[styles.specialtyOptionText, specialty === '' && styles.specialtyOptionTextSelected]}>
                {t('allSpecialties')}
              </Text>
              {specialty === '' && (
                <Ionicons name="checkmark" size={18} color={colors.tealGreen} />
              )}
            </Pressable>
            {specialties.map(s => (
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
    ...shadow('#000', 0, 1, 4, 0.05, 1),
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
