import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import { useScrollToTop } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RescheduleModal } from '@/components/ui/RescheduleModal'
import { VerifiedBadge } from '@/components/ui/VerifiedBadge'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { usePatientAppointments, type PatientAppointment } from '@/hooks/usePatientAppointments'
import { getAuthClient } from '@/lib/supabase'
import { navigateFamilyRoute } from '@/lib/notificationNav'
import { shadow } from '@/lib/shadow'
import { useTranslation } from 'react-i18next'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsultationType = 'chat' | 'phone' | 'video'
type AppointmentTab = 'upcoming' | 'past'

interface Appointment {
  id: string
  doctorId: string
  doctorUserId: string
  doctorName: string
  doctorSpecialty: string
  doctorHospital: string
  doctorIsOnline: boolean
  doctorPhotoUrl: string | null
  doctorStatus: string | null
  type: ConsultationType
  scheduledAt: string
  dateLabel: string
  timeLabel: string
  status: 'pending' | 'scheduled' | 'waiting_for_doctor' | 'active' | 'accepted' | 'in_progress' | 'completed' | 'cancelled'
  amount: number
  isOnDemand: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateLbl(iso: string, todayLabel: string, tomorrowLabel: string): string {
  const d = new Date(iso)
  const tod = new Date()
  const tom = new Date(tod); tom.setDate(tod.getDate() + 1)
  if (d.toDateString() === tod.toDateString()) return todayLabel
  if (d.toDateString() === tom.toDateString()) return tomorrowLabel
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLbl(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Adapts the shared hook's already-fetched-and-classified appointment into
// this screen's display shape — the fetch/classification itself now lives in
// usePatientAppointments so Home and this screen can never disagree about
// which consultations are upcoming vs past. This mapping is pure/local (only
// date/time label formatting, driven by `t`), so it can never retrigger a
// fetch or reset the loading state the way the old per-screen effect did.
function toDisplay(a: PatientAppointment, todayLabel: string, tomorrowLabel: string): Appointment {
  // The card's displayed date/time uses the same fallback chain as the
  // doctor-side and website surfaces (started_at first) so both roles show
  // the identical timestamp for the identical consultation.
  const displayIso = a.startedAt ?? a.scheduledAt ?? a.createdAt
  return {
    id: a.id,
    doctorId: a.doctorId,
    doctorUserId: a.doctorUserId,
    doctorName: a.doctorName,
    doctorSpecialty: a.doctorSpecialty,
    doctorHospital: a.doctorHospital,
    doctorIsOnline: a.doctorIsOnline,
    doctorPhotoUrl: a.doctorPhotoUrl,
    doctorStatus: a.doctorStatus,
    type: a.type,
    scheduledAt: a.scheduledAt,
    dateLabel: dateLbl(displayIso, todayLabel, tomorrowLabel),
    timeLabel: timeLbl(displayIso),
    status: a.status as Appointment['status'],
    amount: a.amount,
    isOnDemand: a.isOnDemand,
  }
}

// ─── Config maps ──────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ConsultationType, string> = {
  chat: 'chatbubble-ellipses',
  phone: 'call',
  video: 'videocam',
}

const TYPE_COLORS: Record<ConsultationType, string> = {
  chat: colors.tealGreen,
  phone: colors.careBlue,
  video: '#7C3AED',
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

function DoctorAvatar({ name, isOnline, photoUrl }: { name: string; isOnline: boolean; photoUrl?: string | null }) {
  const initials = name
    .replace('Dr. ', '')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <View style={avatarStyles.wrapper}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={avatarStyles.circle}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={photoUrl}
        />
      ) : (
        <View style={[avatarStyles.circle, { backgroundColor: avatarColor(name) }]}>
          <Text style={avatarStyles.initials}>{initials}</Text>
        </View>
      )}
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
  onReschedule,
  onCancel,
  onWaitingRoom,
  onOpenDoctor,
}: {
  item: Appointment
  onJoin: (item: Appointment) => void
  onReschedule: (item: Appointment) => void
  onCancel: (item: Appointment) => void
  onWaitingRoom: (item: Appointment) => void
  onOpenDoctor: (item: Appointment) => void
}) {
  const { t } = useTranslation()
  const icon = TYPE_ICONS[item.type]
  const typeLabel = item.type === 'chat' ? t('chat') : item.type === 'phone' ? t('phoneCall') : t('videoCall')
  const joinLabel = item.type === 'chat' ? t('joinChatConsultation') : item.type === 'phone' ? t('joinPhoneCall') : t('joinVideoCall')
  const canJoin = item.status === 'active' || item.status === 'accepted' || item.status === 'in_progress'
  return (
    <View style={cardStyles.card}>
      {/* Top row: avatar + info + date — tap opens the doctor's profile */}
      <Pressable style={({ pressed }) => [cardStyles.topRow, pressed && { opacity: 0.75 }]} onPress={() => onOpenDoctor(item)}>
        <DoctorAvatar name={item.doctorName} isOnline={item.doctorIsOnline} photoUrl={item.doctorPhotoUrl} />

        <View style={cardStyles.info}>
          <View style={cardStyles.doctorNameRow}>
            <Text style={cardStyles.doctorName}>{item.doctorName}</Text>
            {item.doctorStatus === 'approved' && <VerifiedBadge size={13} />}
          </View>
          <Text style={cardStyles.hospital}>{item.doctorHospital}</Text>
          <Text style={cardStyles.specialty}>{item.doctorSpecialty}</Text>
          {item.amount > 0 && <Text style={cardStyles.priceText}>ETB {item.amount.toLocaleString()}</Text>}
        </View>

        <View style={cardStyles.dateBlock}>
          <Text style={cardStyles.dateLabel}>{item.dateLabel}</Text>
          <Text style={cardStyles.timeLabel}>{item.timeLabel}</Text>
          <View style={cardStyles.typeBadge}>
            <View style={[cardStyles.typeIconChip, { backgroundColor: `${TYPE_COLORS[item.type]}18` }]}>
              <Ionicons name={icon as any} size={13} color={TYPE_COLORS[item.type]} />
            </View>
            <Text style={cardStyles.typeText}>{typeLabel}</Text>
          </View>
        </View>
      </Pressable>

      {/* Join button (active) / scheduled-but-not-started / entering waiting room / legacy awaiting confirmation */}
      {canJoin ? (
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
            <Ionicons name={icon as any} size={17} color={colors.mistWhite} style={cardStyles.btnIcon} />
            <Text style={cardStyles.joinBtnText}>{joinLabel}</Text>
          </LinearGradient>
        </Pressable>
      ) : item.status === 'scheduled' ? (
        // Payment succeeded for a future slot — the patient is never told to
        // wait on a confirmation that doesn't exist; the doctor only sees
        // Accept/Decline once scheduled_at actually arrives.
        <View style={{ gap: 8 }}>
          <View style={cardStyles.pendingRow}>
            <Ionicons name="calendar-outline" size={15} color="#6B7280" />
            <Text style={cardStyles.pendingText}>Appointment Scheduled</Text>
          </View>
          <View style={cardStyles.pastActionsRow}>
            <Pressable
              style={({ pressed }) => [cardStyles.rescheduleBtn, { flex: 1 }, pressed && { opacity: 0.75 }]}
              onPress={() => onReschedule(item)}
            >
              <Ionicons name="calendar-outline" size={15} color={colors.careBlue} />
              <Text style={cardStyles.rescheduleBtnText}>Reschedule</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [cardStyles.cancelBtn, { flex: 1 }, pressed && { opacity: 0.75 }]}
              onPress={() => onCancel(item)}
            >
              <Ionicons name="close-circle-outline" size={15} color={colors.error} />
              <Text style={cardStyles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : item.status === 'waiting_for_doctor' ? (
        // scheduled_at has arrived — the global waiting-room recovery effect
        // should already be pulling the patient in silently; this button is
        // the fallback if that hasn't landed yet.
        <Pressable
          style={({ pressed }) => [cardStyles.rescheduleBtn, pressed && { opacity: 0.75 }]}
          onPress={() => onWaitingRoom(item)}
        >
          <Ionicons name="hourglass-outline" size={15} color={colors.careBlue} />
          <Text style={cardStyles.rescheduleBtnText}>Entering waiting room…</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={cardStyles.pendingRow}>
            <Ionicons name="time-outline" size={15} color="#6B7280" />
            <Text style={cardStyles.pendingText}>Awaiting doctor's confirmation</Text>
          </View>
          {item.status === 'pending' && !item.isOnDemand ? (
            <View style={cardStyles.pastActionsRow}>
              <Pressable
                style={({ pressed }) => [cardStyles.rescheduleBtn, { flex: 1 }, pressed && { opacity: 0.75 }]}
                onPress={() => onWaitingRoom(item)}
              >
                <Ionicons name="hourglass-outline" size={15} color={colors.careBlue} />
                <Text style={cardStyles.rescheduleBtnText}>Waiting Room</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [cardStyles.rescheduleBtn, { flex: 1 }, pressed && { opacity: 0.75 }]}
                onPress={() => onReschedule(item)}
              >
                <Ionicons name="calendar-outline" size={15} color={colors.careBlue} />
                <Text style={cardStyles.rescheduleBtnText}>Reschedule</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [cardStyles.rescheduleBtn, pressed && { opacity: 0.75 }]}
              onPress={() => onReschedule(item)}
            >
              <Ionicons name="calendar-outline" size={15} color={colors.careBlue} />
              <Text style={cardStyles.rescheduleBtnText}>Reschedule</Text>
            </Pressable>
          )}
        </View>
      )}
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
  const { t } = useTranslation()
  const icon = TYPE_ICONS[item.type]
  const typeLabel = item.type === 'chat' ? t('chat') : item.type === 'phone' ? t('phoneCall') : t('videoCall')
  return (
    <View style={[cardStyles.card, cardStyles.cardPast]}>
      {/* Top row */}
      <View style={cardStyles.topRow}>
        <DoctorAvatar name={item.doctorName} isOnline={false} photoUrl={item.doctorPhotoUrl} />

        <View style={cardStyles.info}>
          <View style={cardStyles.doctorNameRow}>
            <Text style={cardStyles.doctorName}>{item.doctorName}</Text>
            {item.doctorStatus === 'approved' && <VerifiedBadge size={13} />}
          </View>
          <Text style={cardStyles.hospital}>{item.doctorHospital}</Text>
          <Text style={cardStyles.specialty}>{item.doctorSpecialty}</Text>
          {item.amount > 0 && <Text style={cardStyles.priceText}>ETB {item.amount.toLocaleString()}</Text>}
        </View>

        <View style={cardStyles.dateBlock}>
          <Text style={cardStyles.dateLabel}>{item.dateLabel}</Text>
          <Text style={cardStyles.timeLabelPast}>{item.timeLabel}</Text>
          <View style={cardStyles.typeBadge}>
            <View style={[cardStyles.typeIconChip, { backgroundColor: colors.cloudGrey }]}>
              <Ionicons name={icon as any} size={13} color="#9CA3AF" />
            </View>
            <Text style={[cardStyles.typeText, cardStyles.typeTextPast]}>{typeLabel}</Text>
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
          <Text style={cardStyles.summaryBtnText}>{t('viewSummary')}</Text>
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
            <Text style={cardStyles.bookAgainText}>{t('bookAgain')}</Text>
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
    ...shadow('#000', 0, 2, 8, 0.07, 2),
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
  doctorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  priceText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: colors.inkBlack,
    lineHeight: 17,
    marginTop: 2,
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
    gap: 6,
    marginTop: 4,
  },
  typeIconChip: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
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

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    backgroundColor: colors.cloudGrey,
  },
  pendingText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
  },
  rescheduleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: colors.careBlue,
    backgroundColor: '#EFF6FF',
  },
  rescheduleBtnText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.careBlue },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: colors.error,
    backgroundColor: '#FEF2F2',
  },
  cancelBtnText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.error },
})

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: AppointmentTab }) {
  const { t } = useTranslation()
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
        {tab === 'upcoming' ? t('noUpcomingAppt') : t('noPastAppt')}
      </Text>
      <Text style={emptyStyles.sub}>
        {tab === 'upcoming' ? t('bookDoctorToStart') : t('completedConsultationsHere')}
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
  const { t } = useTranslation()
  const router = useRouter()
  const navContainerRef = useNavigationContainerRef()
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const guardNav = useNavGuard()
  const { getToken, userId: clerkUserId } = useAuth()
  const [activeTab, setActiveTab] = useState<AppointmentTab>(tabParam === 'past' ? 'past' : 'upcoming')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // Single source of truth, shared with the Home screen's Upcoming
  // Appointment widget — see hooks/usePatientAppointments.ts. `isLoading` is
  // only ever true before the first fetch for this user has resolved; a
  // realtime-triggered refresh never flips it back on, so the list can never
  // flicker back to a loading/empty state once real data has been shown.
  const { upcoming: rawUpcoming, past: rawPast, reminders, isLoading } = usePatientAppointments()

  const todayLabel = t('today')
  const tomorrowLabel = t('tomorrow')
  const upcoming = useMemo(
    () => rawUpcoming.map((a) => toDisplay(a, todayLabel, tomorrowLabel)),
    [rawUpcoming, todayLabel, tomorrowLabel]
  )
  const past = useMemo(
    () => rawPast.map((a) => toDisplay(a, todayLabel, tomorrowLabel)),
    [rawPast, todayLabel, tomorrowLabel]
  )

  // This tab screen stays mounted across tab switches, so a plain useState
  // initializer only wins on first-ever mount — re-navigating here with a
  // new ?tab= param (e.g. from consultation-summary after submitting a
  // review) needs an explicit sync or the already-mounted screen ignores it.
  useEffect(() => {
    if (tabParam === 'past' || tabParam === 'upcoming') setActiveTab(tabParam)
  }, [tabParam])

  const list = activeTab === 'upcoming' ? upcoming : past

  const handleJoin = guardNav((item: Appointment) => {
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
        channelId: item.id,
      },
    })
  })

  const handleViewSummary = guardNav((item: Appointment) => {
    router.push({
      pathname: '/(patient)/consultation-summary',
      params: {
        consultationId: item.id,
        doctorId: item.doctorId,
        doctorName: item.doctorName,
        consultationType: item.type,
      },
    })
  })

  const handleBookAgain = guardNav((item: Appointment) => {
    router.push({
      pathname: '/(patient)/doctor-profile',
      params: { id: item.doctorId },
    })
  })

  const handleWaitingRoom = guardNav((item: Appointment) => {
    // A waiting-room instance opened earlier via booking/notification/
    // recovery may already be mounted elsewhere on the stack — reuse it
    // instead of stacking a duplicate (Issue 2: repeated Waiting Room
    // screens).
    navigateFamilyRoute(
      router,
      navContainerRef.current?.getRootState(),
      '/(patient)/waiting-room',
      {
        consultationId: item.id,
        doctorId: item.doctorId,
        doctorName: item.doctorName,
        consultationType: item.type,
      },
      'push',
    )
  })

  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null)

  const handleReschedule = (item: Appointment) => {
    setRescheduleTarget(item)
  }

  // Cancelling a paid, future ('scheduled') appointment converts its
  // payment to consultation credit server-side (migration 104's fix to
  // set_consultation_credit_on_decline) rather than forfeiting it — this was
  // previously only reachable via admin support, which silently dropped the
  // credit entirely.
  const handleCancel = (item: Appointment) => {
    if (cancellingId) return
    Alert.alert(
      'Cancel Appointment',
      `Are you sure you want to cancel your appointment with ${item.doctorName}? Your payment will be converted to consultation credit you can use for a future booking.`,
      [
        { text: 'Keep Appointment', style: 'cancel' },
        {
          text: 'Cancel Appointment',
          style: 'destructive',
          onPress: async () => {
            setCancellingId(item.id)
            try {
              const token = await getToken()
              if (!token || !clerkUserId) throw new Error('Not authenticated')
              const client = getAuthClient(token)
              const { data: me } = await client
                .from('users')
                .select('id')
                .eq('clerk_id', clerkUserId)
                .maybeSingle()
              if (!me) throw new Error('User not found')

              const { error } = await client
                .from('consultations')
                .update({ status: 'cancelled', cancelled_by: me.id })
                .eq('id', item.id)
                .eq('status', 'scheduled')
              if (error) throw error

              Alert.alert('Appointment Cancelled', 'Your appointment has been cancelled and a consultation credit has been issued to your account.')
            } catch {
              Alert.alert('Cancellation Failed', 'Could not cancel your appointment. Please check your connection and try again.')
            } finally {
              setCancellingId(null)
            }
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>{t('appointments')}</Text>
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
                <Text style={styles.segmentTextActive}>{t('upcoming')}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.segmentInactive}>
                <Text style={styles.segmentTextInactive}>{t('upcoming')}</Text>
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
                <Text style={styles.segmentTextActive}>{t('past')}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.segmentInactive}>
                <Text style={styles.segmentTextInactive}>{t('past')}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* ── Follow-up Reminders Banner ── */}
      {reminders.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 4 }}
          style={{ maxHeight: 80, marginBottom: 4 }}
          accessible={true}
          accessibilityLabel="Upcoming follow-up reminders"
        >
          {reminders.map(r => {
            const dt = new Date(r.remind_at)
            const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            return (
              <Pressable
                key={r.id}
                style={reminderStyles.chip}
                onPress={guardNav(() => router.push({ pathname: '/(patient)/consultation-summary' as any, params: { consultationId: r.consultation_id } }))}
                accessibilityRole="button"
                accessibilityLabel={`Follow-up reminder: ${r.message ?? 'scheduled reminder'} on ${dateStr} at ${timeStr}`}
              >
                <Ionicons name="notifications" size={16} color={colors.careBlue} style={reminderStyles.chipIcon} />
                <View>
                  <Text style={reminderStyles.chipMsg} numberOfLines={1}>{r.message ?? 'Follow-up reminder'}</Text>
                  <Text style={reminderStyles.chipDate}>{dateStr} · {timeStr}</Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {/* ── List ── */}
      <FlatList
        ref={listRef}
        data={list}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <View style={emptyStyles.container}>
              <ActivityIndicator size="small" color={colors.steelGrey} />
            </View>
          ) : (
            <EmptyState tab={activeTab} />
          )
        }
        renderItem={({ item }) =>
          activeTab === 'upcoming' ? (
            <UpcomingCard item={item} onJoin={handleJoin} onReschedule={handleReschedule} onCancel={handleCancel} onWaitingRoom={handleWaitingRoom} onOpenDoctor={handleBookAgain} />
          ) : (
            <PastCard
              item={item}
              onViewSummary={handleViewSummary}
              onBookAgain={handleBookAgain}
            />
          )
        }
      />

      <RescheduleModal
        visible={!!rescheduleTarget}
        appointment={rescheduleTarget ? {
          id: rescheduleTarget.id,
          doctorId: rescheduleTarget.doctorId,
          doctorName: rescheduleTarget.doctorName,
          type: rescheduleTarget.type,
          scheduledAt: rescheduleTarget.scheduledAt,
        } : null}
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => setRescheduleTarget(null)}
      />
    </SafeAreaView>
  )
}

const reminderStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#E6F9F7', borderWidth: 1, borderColor: colors.tealGreen,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 260,
  },
  chipIcon: { fontSize: 16 },
  chipMsg: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.inkBlack, maxWidth: 180 },
  chipDate: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', marginTop: 1 },
})

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
    ...shadow('#000', 0, 1, 4, 0.06, 1),
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
