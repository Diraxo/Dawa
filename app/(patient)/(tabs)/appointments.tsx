import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useScrollToTop } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { formatDoctorName } from '@/lib/nameFormat'
import { useTranslation } from 'react-i18next'

interface FollowupReminder {
  id: string
  remind_at: string
  message: string | null
  consultation_id: string
}

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

// On-demand bookings set scheduled_at = new Date() which has non-zero seconds.
// Scheduled slot times are always parsed as HH:MM:00 (zero seconds).
function isOnDemandRow(row: any): boolean {
  if (!row.scheduled_at) return true
  const s = new Date(row.scheduled_at)
  return s.getSeconds() !== 0 || s.getMilliseconds() !== 0
}

function mapAppointment(row: any, todayLabel: string, tomorrowLabel: string): Appointment {
  const dp = row.doctor_profiles as any
  // scheduledAt drives sorting, join params, and reschedule — keep it exactly
  // as before (the booked slot time), untouched by the display-timestamp fix below.
  const iso = row.scheduled_at ?? row.created_at ?? new Date().toISOString()
  // The card's displayed date/time uses the same fallback chain as the
  // doctor-side and website surfaces (started_at first) so both roles show
  // the identical timestamp for the identical consultation.
  const displayIso = row.started_at ?? row.scheduled_at ?? row.created_at ?? new Date().toISOString()
  return {
    id: row.id,
    doctorId: dp?.id ?? '',
    doctorUserId: dp?.users?.id ?? '',
    doctorName: formatDoctorName(dp?.users?.full_name, 'Doctor'),
    doctorSpecialty: dp?.specialty ?? 'General',
    doctorHospital: dp?.hospital_name ?? '',
    doctorIsOnline: dp?.is_online ?? false,
    doctorPhotoUrl: dp?.users?.profile_photo_url ?? null,
    doctorStatus: dp?.status ?? null,
    type: (row.type ?? 'chat') as ConsultationType,
    scheduledAt: iso,
    dateLabel: dateLbl(displayIso, todayLabel, tomorrowLabel),
    timeLabel: timeLbl(displayIso),
    status: (row.status ?? 'pending') as Appointment['status'],
    amount: Number(row.patient_amount) || 0,
    isOnDemand: isOnDemandRow(row),
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
  onWaitingRoom,
  onOpenDoctor,
}: {
  item: Appointment
  onJoin: (item: Appointment) => void
  onReschedule: (item: Appointment) => void
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
          <Pressable
            style={({ pressed }) => [cardStyles.rescheduleBtn, pressed && { opacity: 0.75 }]}
            onPress={() => onReschedule(item)}
          >
            <Ionicons name="calendar-outline" size={15} color={colors.careBlue} />
            <Text style={cardStyles.rescheduleBtnText}>Reschedule</Text>
          </Pressable>
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
  const { getToken, userId: clerkUserId } = useAuth()
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>()
  const listRef = useRef<FlatList>(null)
  useScrollToTop(listRef)
  const guardNav = useNavGuard()
  const [activeTab, setActiveTab] = useState<AppointmentTab>(tabParam === 'past' ? 'past' : 'upcoming')
  const [upcoming, setUpcoming] = useState<Appointment[]>([])
  const [past, setPast] = useState<Appointment[]>([])
  // True until the first fetch (this mount/focus) actually completes — gates
  // the FlatList's empty state so "No upcoming/past appointments" can only
  // ever render once the server has genuinely confirmed there are none, not
  // just because `upcoming`/`past` haven't been populated yet.
  const [isLoading, setIsLoading] = useState(true)
  // Mirrors upcoming/past so the users-table realtime handler (below) can
  // check "is this changed doctor one of mine?" without a stale closure.
  const upcomingRef = useRef<Appointment[]>([])
  const pastRef = useRef<Appointment[]>([])
  useEffect(() => { upcomingRef.current = upcoming }, [upcoming])
  useEffect(() => { pastRef.current = past }, [past])
  const [reminders, setReminders] = useState<FollowupReminder[]>([])
  const upcomingCacheKey = clerkUserId ? `patient-appointments-upcoming:${clerkUserId}` : null
  const pastCacheKey = clerkUserId ? `patient-appointments-past:${clerkUserId}` : null

  // Paint the last-known lists from disk immediately on mount, before the
  // real fetch below even starts.
  useEffect(() => {
    if (!upcomingCacheKey || !pastCacheKey) return
    let cancelled = false
    getCachedJson<Appointment[]>(upcomingCacheKey).then((cached) => {
      if (cached && !cancelled) setUpcoming(cached)
    })
    getCachedJson<Appointment[]>(pastCacheKey).then((cached) => {
      if (cached && !cancelled) setPast(cached)
    })
    return () => { cancelled = true }
  }, [upcomingCacheKey, pastCacheKey])

  // This tab screen stays mounted across tab switches, so a plain useState
  // initializer only wins on first-ever mount — re-navigating here with a
  // new ?tab= param (e.g. from consultation-summary after submitting a
  // review) needs an explicit sync or the already-mounted screen ignores it.
  useEffect(() => {
    if (tabParam === 'past' || tabParam === 'upcoming') setActiveTab(tabParam)
  }, [tabParam])

  const loadAppointments = useCallback(async (client: ReturnType<typeof getAuthClient>, patientId: string) => {
    const [{ data }, { data: reminderData }] = await Promise.all([
      client
        .from('consultations')
        .select(`
          id, type, status, payment_status, scheduled_at, started_at, created_at, patient_amount,
          doctor_profiles!inner(id, specialty, hospital_name, is_online, status, users!inner(id, full_name, profile_photo_url))
        `)
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false }),
      client
        .from('followup_reminders')
        .select('id, remind_at, message, consultation_id')
        .eq('patient_id', patientId)
        .eq('sent', false)
        .gte('remind_at', new Date().toISOString())
        .order('remind_at', { ascending: true })
        .limit(3),
    ])
    if (reminderData) setReminders(reminderData as FollowupReminder[])
    if (!data) return

    const now = new Date()
    const todayLabel = t('today')
    const tomorrowLabel = t('tomorrow')
    const mapAppt = (row: any) => mapAppointment(row, todayLabel, tomorrowLabel)

    // Upcoming: active, scheduled (not yet activated), OR legacy paid-pending scheduled (future only)
    // Sorted nearest-first (ascending) — the base query orders descending for
    // "past" to show most-recent-first, so upcoming needs its own re-sort.
    const nextUpcoming = data.filter(r => {
        if (r.status === 'active') return true
        if (r.status === 'scheduled') return true
        // The doctor has accepted (or the call is already underway) but the
        // patient hasn't navigated in yet — the realtime recovery listener
        // in app/_layout.tsx normally sweeps the patient straight into the
        // call, but this card must still exist (with a working Join button)
        // for the brief window before that happens, and as a fallback if it
        // doesn't. Without this branch the row vanished from both tabs the
        // instant the doctor accepted.
        if (r.status === 'accepted' || r.status === 'in_progress') return true
        // A scheduled appointment sits here for the brief window between the
        // server-time cron activating it (scheduled_at reached) and the
        // doctor accepting — without this branch the row vanished from both
        // tabs entirely for that window.
        if (r.status === 'waiting_for_doctor' && !isOnDemandRow(r)) return true
        if (r.status === 'pending' && r.payment_status === 'paid' && !isOnDemandRow(r)) {
          return new Date(r.scheduled_at) > now
        }
        return false
      }).map(mapAppt).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    setUpcoming(nextUpcoming)
    if (upcomingCacheKey) setCachedJson(upcomingCacheKey, nextUpcoming)

    // Past: completed, or cancelled ONLY if payment was already confirmed
    // (payment-failure cancellations have payment_status='pending' — hide them)
    const nextPast = data.filter(r => {
        if (r.status === 'completed') return true
        if (r.status === 'cancelled' && r.payment_status === 'paid') return true
        if (r.status === 'pending' && r.payment_status === 'paid' && !isOnDemandRow(r)) {
          return new Date(r.scheduled_at) <= now
        }
        return false
      }).map(mapAppt)
    setPast(nextPast)
    if (pastCacheKey) setCachedJson(pastCacheKey, nextPast)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, upcomingCacheKey, pastCacheKey])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      let channel: ReturnType<typeof supabase.channel> | null = null
      setIsLoading(true)

      getToken().then(async token => {
        if (!token || cancelled) { if (!cancelled) setIsLoading(false); return }
        const client = getAuthClient(token)
        const { data: me } = await client.from('users').select('id').eq('clerk_id', clerkUserId).maybeSingle()
        if (!me || cancelled) { if (!cancelled) setIsLoading(false); return }
        await loadAppointments(client, me.id)
        setIsLoading(false)
        if (cancelled) return

        // Live-refresh while the tab is focused (new scheduled booking,
        // reschedule, doctor accepting/declining, cancellation) — the
        // useFocusEffect re-fetch above only catches changes made while this
        // tab was NOT focused.
        channel = supabase
          .channel(`patient-appointments-${me.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'consultations', filter: `patient_id=eq.${me.id}` },
            async () => {
              const freshToken = await getToken()
              if (!freshToken) return
              await loadAppointments(getAuthClient(freshToken), me.id)
            }
          )
          .on(
            // A doctor editing their name/photo/bio doesn't touch
            // `consultations` at all, so the subscription above never fires
            // for it — without this, a patient sitting on this tab keeps
            // seeing the doctor's old identity until they navigate away and back.
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'users' },
            async (payload) => {
              const updated = payload.new as any
              const isMyDoctor =
                upcomingRef.current.some((a) => a.doctorUserId === updated.id) ||
                pastRef.current.some((a) => a.doctorUserId === updated.id)
              if (!isMyDoctor) return
              const freshToken = await getToken()
              if (!freshToken) return
              await loadAppointments(getAuthClient(freshToken), me.id)
            }
          )
          .on(
            // Same gap as above but for doctor_profiles fields (is_online,
            // specialty, hospital_name) — a doctor going online/offline while
            // a patient sits on this tab previously stayed frozen at whatever
            // it was on the last fetch/focus, unlike doctors.tsx/home.tsx
            // which already subscribe to this table.
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
            async (payload) => {
              const updated = payload.new as any
              const isMyDoctor =
                upcomingRef.current.some((a) => a.doctorId === updated.id) ||
                pastRef.current.some((a) => a.doctorId === updated.id)
              if (!isMyDoctor) return
              const freshToken = await getToken()
              if (!freshToken) return
              await loadAppointments(getAuthClient(freshToken), me.id)
            }
          )
          .subscribe()
      }).catch(() => {
        // A network failure anywhere in the chain above (no .catch existed
        // before) otherwise left isLoading stuck true forever, since none of
        // the explicit early-return branches run on a thrown/rejected error.
        if (!cancelled) setIsLoading(false)
      })
      return () => { cancelled = true; if (channel) supabase.removeChannel(channel) }
    }, [getToken, clerkUserId, loadAppointments])
  )

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
    router.push({
      pathname: '/(patient)/waiting-room' as any,
      params: {
        consultationId: item.id,
        doctorId: item.doctorId,
        doctorName: item.doctorName,
        consultationType: item.type,
      },
    })
  })

  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null)

  const handleReschedule = (item: Appointment) => {
    setRescheduleTarget(item)
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
            <UpcomingCard item={item} onJoin={handleJoin} onReschedule={handleReschedule} onWaitingRoom={handleWaitingRoom} onOpenDoctor={handleBookAgain} />
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
