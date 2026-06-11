import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useScrollToTop } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { getAuthClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsultationType = 'chat' | 'phone' | 'video'
type AppointmentTab = 'upcoming' | 'past'

interface Appointment {
  id: string
  doctorId: string
  doctorName: string
  doctorSpecialty: string
  doctorHospital: string
  doctorIsOnline: boolean
  type: ConsultationType
  scheduledAt: string
  dateLabel: string
  timeLabel: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateLbl(iso: string): string {
  const d = new Date(iso)
  const tod = new Date()
  const tom = new Date(tod); tom.setDate(tod.getDate() + 1)
  if (d.toDateString() === tod.toDateString()) return 'Today'
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLbl(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function mapAppointment(row: any): Appointment {
  const dp = row.doctor_profiles as any
  const iso = row.scheduled_at ?? row.created_at ?? new Date().toISOString()
  return {
    id: row.id,
    doctorId: dp?.id ?? '',
    doctorName: dp?.users?.full_name ?? 'Doctor',
    doctorSpecialty: dp?.specialty ?? 'General',
    doctorHospital: dp?.hospital_name ?? '',
    doctorIsOnline: dp?.is_online ?? false,
    type: (row.type ?? 'chat') as ConsultationType,
    scheduledAt: iso,
    dateLabel: dateLbl(iso),
    timeLabel: timeLbl(iso),
  }
}

// ─── Config maps ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ConsultationType, { label: string; icon: string; joinLabel: string }> = {
  chat: {
    label: 'Chat',
    icon: 'chatbubble-ellipses',
    joinLabel: 'Join Consultation (Chat)',
  },
  phone: {
    label: 'Phone Call',
    icon: 'call',
    joinLabel: 'Join Phone Call',
  },
  video: {
    label: 'Video Call',
    icon: 'videocam',
    joinLabel: 'Join Video Call',
  },
}

// Deterministic avatar color from name initial
const AVATAR_COLORS = [
  '#1A4598', '#00BFA5', '#2962FF', '#7C3AED',
  '#DC2626', '#D97706', '#059669', '#0284C7',
]
function avatarColor(name: string): string {
  const idx = name.charCodeAt(4) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DoctorAvatar({ name, isOnline }: { name: string; isOnline: boolean }) {
  const initials = name
    .replace('Dr. ', '')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <View style={avatarStyles.wrapper}>
      <View style={[avatarStyles.circle, { backgroundColor: avatarColor(name) }]}>
        <Text style={avatarStyles.initials}>{initials}</Text>
      </View>
      {isOnline && <View style={avatarStyles.onlineDot} />}
    </View>
  )
}

const avatarStyles = StyleSheet.create({
  wrapper: {
    width: 58,
    height: 58,
    position: 'relative',
  },
  circle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.mistWhite,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.mistWhite,
  },
})

// ─── Upcoming card ────────────────────────────────────────────────────────────

function UpcomingCard({
  item,
  onJoin,
}: {
  item: Appointment
  onJoin: (item: Appointment) => void
}) {
  const cfg = TYPE_CONFIG[item.type]
  return (
    <View style={cardStyles.card}>
      {/* Top row: avatar + info + date */}
      <View style={cardStyles.topRow}>
        <DoctorAvatar name={item.doctorName} isOnline={item.doctorIsOnline} />

        <View style={cardStyles.info}>
          <Text style={cardStyles.doctorName}>{item.doctorName}</Text>
          <Text style={cardStyles.hospital}>{item.doctorHospital}</Text>
          <Text style={cardStyles.specialty}>{item.doctorSpecialty}</Text>
        </View>

        <View style={cardStyles.dateBlock}>
          <Text style={cardStyles.dateLabel}>{item.dateLabel}</Text>
          <Text style={cardStyles.timeLabel}>{item.timeLabel}</Text>
          <View style={cardStyles.typeBadge}>
            <Ionicons name={cfg.icon as any} size={12} color="#6B7280" />
            <Text style={cardStyles.typeText}>{cfg.label}</Text>
          </View>
        </View>
      </View>

      {/* Join button */}
      <Pressable
        style={({ pressed }) => [cardStyles.btnWrap, pressed && { opacity: 0.88 }]}
        onPress={() => onJoin(item)}
      >
        <LinearGradient
          colors={gradients.interactive}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={cardStyles.joinBtn}
        >
          <Ionicons name={cfg.icon as any} size={17} color={colors.mistWhite} style={cardStyles.btnIcon} />
          <Text style={cardStyles.joinBtnText}>{cfg.joinLabel}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  )
}

// ─── Past card ────────────────────────────────────────────────────────────────

function PastCard({
  item,
  onViewSummary,
  onBookAgain,
}: {
  item: Appointment
  onViewSummary: (item: Appointment) => void
  onBookAgain: (item: Appointment) => void
}) {
  const cfg = TYPE_CONFIG[item.type]
  return (
    <View style={[cardStyles.card, cardStyles.cardPast]}>
      {/* Top row */}
      <View style={cardStyles.topRow}>
        <DoctorAvatar name={item.doctorName} isOnline={false} />

        <View style={cardStyles.info}>
          <Text style={cardStyles.doctorName}>{item.doctorName}</Text>
          <Text style={cardStyles.hospital}>{item.doctorHospital}</Text>
          <Text style={cardStyles.specialty}>{item.doctorSpecialty}</Text>
        </View>

        <View style={cardStyles.dateBlock}>
          <Text style={cardStyles.dateLabel}>{item.dateLabel}</Text>
          <Text style={cardStyles.timeLabelPast}>{item.timeLabel}</Text>
          <View style={cardStyles.typeBadge}>
            <Ionicons name={cfg.icon as any} size={12} color="#9CA3AF" />
            <Text style={[cardStyles.typeText, cardStyles.typeTextPast]}>{cfg.label}</Text>
          </View>
        </View>
      </View>

      {/* Two action buttons */}
      <View style={cardStyles.pastActionsRow}>
        <Pressable
          style={({ pressed }) => [cardStyles.summaryBtn, pressed && { opacity: 0.75 }]}
          onPress={() => onViewSummary(item)}
        >
          <Ionicons name="document-text-outline" size={15} color={colors.careBlue} />
          <Text style={cardStyles.summaryBtnText}>View Summary</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [cardStyles.bookAgainWrap, pressed && { opacity: 0.88 }]}
          onPress={() => onBookAgain(item)}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={cardStyles.bookAgainBtn}
          >
            <Ionicons name="refresh" size={15} color={colors.mistWhite} />
            <Text style={cardStyles.bookAgainText}>Book Again</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  )
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPast: {
    opacity: 0.95,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  doctorName: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.inkBlack,
    lineHeight: 21,
  },
  hospital: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
  },
  specialty: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.careBlue,
    lineHeight: 17,
  },
  dateBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  dateLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  timeLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.inkBlack,
    lineHeight: 24,
  },
  timeLabelPast: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: '#9CA3AF',
    lineHeight: 24,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  typeText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#6B7280',
  },
  typeTextPast: {
    color: '#9CA3AF',
  },

  // Upcoming — join button
  btnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  joinBtn: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    gap: 8,
  },
  btnIcon: {
    marginRight: 2,
  },
  joinBtnText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.mistWhite,
  },

  // Past — two-button row
  pastActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryBtn: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.careBlue,
    backgroundColor: '#EFF6FF',
  },
  summaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.careBlue,
  },
  bookAgainWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  bookAgainBtn: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
  },
  bookAgainText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.mistWhite,
  },
})

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: AppointmentTab }) {
  return (
    <View style={emptyStyles.container}>
      <View style={emptyStyles.iconWrap}>
        <Ionicons
          name={tab === 'upcoming' ? 'calendar-outline' : 'time-outline'}
          size={48}
          color={colors.steelGrey}
        />
      </View>
      <Text style={emptyStyles.title}>
        {tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
      </Text>
      <Text style={emptyStyles.sub}>
        {tab === 'upcoming'
          ? 'Book a consultation with a doctor to get started.'
          : 'Your completed consultations will appear here.'}
      </Text>
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: colors.inkBlack,
    marginBottom: 8,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
})

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AppointmentsScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const [activeTab, setActiveTab] = useState<AppointmentTab>('upcoming')
  const [upcoming, setUpcoming] = useState<Appointment[]>([])
  const [past, setPast] = useState<Appointment[]>([])

  useEffect(() => {
    getToken().then(token => {
      if (!token) return
      const client = getAuthClient(token)
      client
        .from('consultations')
        .select(`
          id, type, status, scheduled_at, created_at,
          doctor_profiles!inner(id, specialty, hospital_name, is_online, users!inner(full_name))
        `)
        .order('scheduled_at', { ascending: false })
        .then(({ data }) => {
          if (!data) return
          setUpcoming(data.filter(r => ['pending', 'active'].includes(r.status)).map(mapAppointment))
          setPast(data.filter(r => ['completed', 'cancelled'].includes(r.status)).map(mapAppointment))
        })
    })
  }, [])

  const list = activeTab === 'upcoming' ? upcoming : past

  const handleJoin = (item: Appointment) => {
    const routes: Record<ConsultationType, string> = {
      chat: '/(patient)/chat-consultation',
      phone: '/(patient)/phone-consultation',
      video: '/(patient)/video-consultation',
    }
    router.push({
      pathname: routes[item.type] as any,
      params: {
        doctorId: item.doctorId,
        doctorName: item.doctorName,
        consultationType: item.type,
        scheduledAt: item.scheduledAt,
        consultationId: item.id,
      },
    })
  }

  const handleViewSummary = (item: Appointment) => {
    router.push({
      pathname: '/(patient)/consultation-summary',
      params: {
        doctorId: item.doctorId,
        doctorName: item.doctorName,
        consultationType: item.type,
      },
    })
  }

  const handleBookAgain = (item: Appointment) => {
    router.push({
      pathname: '/(patient)/doctor-profile',
      params: { id: item.doctorId },
    })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Appointments</Text>
      </View>

      {/* ── Segmented control ── */}
      <View style={styles.segmentWrapper}>
        <View style={styles.segmentTrack}>
          <Pressable
            style={styles.segmentItem}
            onPress={() => setActiveTab('upcoming')}
          >
            {activeTab === 'upcoming' ? (
              <LinearGradient
                colors={gradients.hero}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.segmentActive}
              >
                <Text style={styles.segmentTextActive}>Upcoming</Text>
              </LinearGradient>
            ) : (
              <View style={styles.segmentInactive}>
                <Text style={styles.segmentTextInactive}>Upcoming</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={styles.segmentItem}
            onPress={() => setActiveTab('past')}
          >
            {activeTab === 'past' ? (
              <LinearGradient
                colors={gradients.hero}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.segmentActive}
              >
                <Text style={styles.segmentTextActive}>Past</Text>
              </LinearGradient>
            ) : (
              <View style={styles.segmentInactive}>
                <Text style={styles.segmentTextInactive}>Past</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* ── List ── */}
      <FlatList
        ref={listRef}
        data={list}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState tab={activeTab} />}
        renderItem={({ item }) =>
          activeTab === 'upcoming' ? (
            <UpcomingCard item={item} onJoin={handleJoin} />
          ) : (
            <PastCard
              item={item}
              onViewSummary={handleViewSummary}
              onBookAgain={handleBookAgain}
            />
          )
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.cloudGrey,
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  screenTitle: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.inkBlack,
  },

  // Segmented control
  segmentWrapper: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.mistWhite,
    borderRadius: 30,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  segmentItem: {
    flex: 1,
  },
  segmentActive: {
    height: 40,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentInactive: {
    height: 40,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTextActive: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.mistWhite,
  },
  segmentTextInactive: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
})
