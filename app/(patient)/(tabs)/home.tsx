import { Ionicons } from '@expo/vector-icons'
import { useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { DoctorCard, Doctor } from '@/components/ui/DoctorCard'
import { QuickActionCard } from '@/components/ui/QuickActionCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'

// ─── Mock data — swap with Supabase hooks when backend is ready ───────────────

// Specialties: replace with → supabase.from('specialties').select('*').order('name')
// Admin manages this table (add/remove via the web admin dashboard)
const MOCK_SPECIALTIES = [
  'General',
  'Dermatology',
  'Pediatrics',
  'Mental Health',
  'Cardiology',
  'Neurology',
  'Orthopedics',
]

// Prices are flat per-session rates (not hourly) — chat_price / phone_price / video_price
const AVAILABLE_DOCTORS: Doctor[] = [
  {
    id: '1',
    name: 'Dr. Eleni Tesfaye',
    subtitle: 'Tikur Anbessa Hospital',
    specialty: 'General Practitioner',
    rating_average: 4.9,
    review_count: 112,
    chat_price: 100,
    phone_price: 150,
    video_price: 300,
    is_online: true,
    profile_photo_url: null,
  },
  {
    id: '2',
    name: 'Dr. Mark Wilson',
    subtitle: 'USA',
    specialty: 'Dermatologist',
    rating_average: 4.8,
    review_count: 95,
    chat_price: 150,
    phone_price: 200,
    video_price: 380,
    is_online: true,
    profile_photo_url: null,
  },
  {
    id: '3',
    name: 'Dr. Jean-Pierre Nshimiye',
    subtitle: 'Rwanda',
    specialty: 'Pediatrician',
    rating_average: 4.7,
    review_count: 81,
    chat_price: 130,
    phone_price: 180,
    video_price: 320,
    is_online: true,
    profile_photo_url: null,
  },
  {
    id: '4',
    name: 'Dr. Amina Hassan',
    subtitle: 'Somalia',
    specialty: 'Cardiologist',
    rating_average: 4.6,
    review_count: 67,
    chat_price: 200,
    phone_price: 260,
    video_price: 450,
    is_online: true,
    profile_photo_url: null,
  },
]

const TOP_RATED_DOCTORS: Doctor[] = [
  {
    id: '5',
    name: 'Dr. Samuel Bekele',
    subtitle: 'Black Lion Hospital',
    specialty: 'Neurologist',
    rating_average: 5.0,
    review_count: 243,
    chat_price: 250,
    phone_price: 320,
    video_price: 500,
    is_online: false,
    profile_photo_url: null,
  },
  {
    id: '6',
    name: 'Dr. Fatima Al-Rashid',
    subtitle: 'UAE',
    specialty: 'Psychiatrist',
    rating_average: 4.9,
    review_count: 189,
    chat_price: 180,
    phone_price: 230,
    video_price: 400,
    is_online: true,
    profile_photo_url: null,
  },
  {
    id: '7',
    name: 'Dr. Kidist Alemu',
    subtitle: 'Ethiopia',
    specialty: 'Orthopedic Surgeon',
    rating_average: 4.8,
    review_count: 156,
    chat_price: 220,
    phone_price: 280,
    video_price: 450,
    is_online: false,
    profile_photo_url: null,
  },
  {
    id: '8',
    name: 'Dr. Yonas Haile',
    subtitle: 'Yekatit 12 Hospital',
    specialty: 'Dermatologist',
    rating_average: 4.8,
    review_count: 134,
    chat_price: 160,
    phone_price: 210,
    video_price: 360,
    is_online: true,
    profile_photo_url: null,
  },
]

const MOCK_APPOINTMENT = {
  doctorName: 'Dr. Tesfaye',
  language: 'Afaan Oromoo',
  date: 'Oct 26',
  time: '10:30 AM',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter()
  const { user } = useUser()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>('General')

  // Specialties: replace useState init with Supabase fetch when ready
  // → supabase.from('specialties').select('*').order('name')
  const [specialties] = useState<string[]>(MOCK_SPECIALTIES)

  const firstName =
    user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'there'

  const handleDoctorPress = (id: string) => {
    router.push({ pathname: '/(patient)/doctor-profile', params: { id } })
  }

  const handleSpecialtyPress = (specialty: string) => {
    setSelectedSpecialty((prev) => (prev === specialty ? null : specialty))
  }

  const handleQuickAction = () => {
    router.push('/(patient)/(tabs)/doctors')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
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
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
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
            placeholder="Find a doctor, specialty, or condition..."
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
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Text style={styles.sectionSubtitle}>Start a consultation</Text>
        </View>
        <View style={styles.quickActionsRow}>
          <QuickActionCard
            label="Chat Consult"
            icon="chatbubble-ellipses"
            variant="outline"
            onPress={handleQuickAction}
          />
          <QuickActionCard
            label="Phone Call"
            icon="call"
            variant="teal"
            onPress={handleQuickAction}
          />
          <QuickActionCard
            label="Video Call"
            icon="videocam"
            variant="blue"
            onPress={handleQuickAction}
          />
        </View>

        {/* ── Specialties ── */}
        <Text style={[styles.sectionTitle, styles.mt24]}>Specialties</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.specialtiesRow}
          style={styles.mt12}
        >
          {specialties.map((specialty) => {
            const selected = selectedSpecialty === specialty
            return (
              <Pressable
                key={specialty}
                onPress={() => handleSpecialtyPress(specialty)}
                style={({ pressed }) => [
                  styles.pill,
                  selected && styles.pillSelected,
                  pressed && { opacity: 0.8 },
                ]}
              >
                {selected && (
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={colors.mistWhite}
                    style={styles.checkIcon}
                  />
                )}
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {specialty}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {/* ── Available Now ── */}
        <View style={[styles.sectionRow, styles.mt24]}>
          <Text style={styles.sectionTitle}>Available Now</Text>
          <View style={styles.onlineDot} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.doctorListContent}
          style={styles.mt12}
        >
          {AVAILABLE_DOCTORS.map((doc) => (
            <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} />
          ))}
        </ScrollView>

        {/* ── Top Rated Doctors ── */}
        <View style={[styles.sectionRowSpaced, styles.mt28]}>
          <Text style={styles.sectionTitle}>Top Rated Doctors</Text>
          <Pressable onPress={() => router.push('/(patient)/(tabs)/doctors')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.doctorListContent}
          style={styles.mt12}
        >
          {TOP_RATED_DOCTORS.map((doc) => (
            <DoctorCard key={doc.id} doctor={doc} onPress={handleDoctorPress} />
          ))}
        </ScrollView>

        {/* ── Upcoming Appointment ── */}
        <Text style={[styles.sectionTitle, styles.mt28]}>Upcoming Appointment</Text>
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
                  Consultation with {MOCK_APPOINTMENT.doctorName}
                </Text>
                <Text style={styles.apptMeta}>
                  {MOCK_APPOINTMENT.language} · {MOCK_APPOINTMENT.date} at{' '}
                  {MOCK_APPOINTMENT.time}
                </Text>
              </View>
            </View>
            <View style={styles.viewDetailsBtn}>
              <Text style={styles.viewDetailsText}>View Details</Text>
            </View>
          </LinearGradient>
        </Pressable>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
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

  // Specialties
  specialtiesRow: {
    gap: 10,
    paddingRight: 20,
    paddingBottom: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.mistWhite,
    borderWidth: 1,
    borderColor: colors.steelGrey,
  },
  pillSelected: {
    backgroundColor: colors.tealGreen,
    borderColor: colors.tealGreen,
  },
  checkIcon: {
    marginRight: 4,
  },
  pillText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#374151',
  },
  pillTextSelected: {
    color: colors.mistWhite,
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
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
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

  // Spacing utilities
  mt12: { marginTop: 12 },
  mt24: { marginTop: 24 },
  mt28: { marginTop: 28 },
  bottomPad: { height: 28 },
})
