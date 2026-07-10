import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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

import { GradientButton } from '@/components/ui/GradientButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorOnlineToggle } from '@/hooks/useDoctorOnlineToggle'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

interface DayAvailability {
  enabled: boolean
  startTime: string
  endTime: string
}

interface Appointment {
  id: string
  patientName: string
  date: string
  time: string
  type: 'chat' | 'phone' | 'video'
}

const DEFAULT_AVAILABILITY: Record<DayKey, DayAvailability> = {
  Mon: { enabled: true, startTime: '09:00 AM', endTime: '05:00 PM' },
  Tue: { enabled: true, startTime: '09:00 AM', endTime: '05:00 PM' },
  Wed: { enabled: true, startTime: '09:00 AM', endTime: '05:00 PM' },
  Thu: { enabled: true, startTime: '09:00 AM', endTime: '05:00 PM' },
  Fri: { enabled: true, startTime: '09:00 AM', endTime: '05:00 PM' },
  Sat: { enabled: false, startTime: '10:00 AM', endTime: '02:00 PM' },
  Sun: { enabled: false, startTime: '10:00 AM', endTime: '02:00 PM' },
}

const DAYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_ICONS: Record<'chat' | 'phone' | 'video', keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam',
}

const TYPE_COLORS: Record<'chat' | 'phone' | 'video', string> = {
  chat: colors.tealGreen, phone: colors.careBlue, video: '#7C3AED',
}

function formatApptDate(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const date = sameDay(d, today)
    ? 'Today'
    : sameDay(d, tomorrow)
      ? 'Tomorrow'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return { date, time }
}

// ─── Time picker helpers ──────────────────────────────────────────────────────

function parseTime(t12: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  const [time, period] = t12.split(' ')
  const [h, m] = time.split(':').map(Number)
  return { hour: h, minute: m, period: (period ?? 'AM') as 'AM' | 'PM' }
}

function formatTime(hour: number, minute: number, period: 'AM' | 'PM'): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = [0, 15, 30, 45]

function TimePickerModal({
  visible,
  initial,
  label,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  initial: string
  label: string
  onConfirm: (time: string) => void
  onCancel: () => void
}) {
  const parsed = parseTime(initial)
  const [hour, setHour] = useState(parsed.hour)
  const [minute, setMinute] = useState(parsed.minute)
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed.period)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={tpStyles.overlay}>
        <Pressable style={tpStyles.backdrop} onPress={onCancel} />
        <View style={tpStyles.sheet}>
          <View style={tpStyles.handle} />
          <Text style={tpStyles.title}>{label}</Text>
          <View style={tpStyles.pickerRow}>
            {/* Hours */}
            <View style={tpStyles.col}>
              <Text style={tpStyles.colLabel}>Hour</Text>
              <ScrollView style={tpStyles.colScroll} showsVerticalScrollIndicator={false}>
                {HOURS.map(h => (
                  <Pressable key={h} onPress={() => setHour(h)} style={[tpStyles.item, hour === h && tpStyles.itemSelected]}>
                    <Text style={[tpStyles.itemText, hour === h && tpStyles.itemTextSelected]}>{String(h).padStart(2, '0')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <Text style={tpStyles.colon}>:</Text>
            {/* Minutes */}
            <View style={tpStyles.col}>
              <Text style={tpStyles.colLabel}>Min</Text>
              <ScrollView style={tpStyles.colScroll} showsVerticalScrollIndicator={false}>
                {MINUTES.map(m => (
                  <Pressable key={m} onPress={() => setMinute(m)} style={[tpStyles.item, minute === m && tpStyles.itemSelected]}>
                    <Text style={[tpStyles.itemText, minute === m && tpStyles.itemTextSelected]}>{String(m).padStart(2, '0')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            {/* AM/PM */}
            <View style={[tpStyles.col, { gap: 8 }]}>
              <Text style={tpStyles.colLabel}>Period</Text>
              {(['AM', 'PM'] as const).map(p => (
                <Pressable key={p} onPress={() => setPeriod(p)} style={[tpStyles.item, period === p && tpStyles.itemSelected]}>
                  <Text style={[tpStyles.itemText, period === p && tpStyles.itemTextSelected]}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable
            onPress={() => onConfirm(formatTime(hour, minute, period))}
            style={tpStyles.confirmBtn}
          >
            <Text style={tpStyles.confirmText}>Confirm</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const tpStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 32,
  },
  handle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, marginBottom: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 },
  col: { alignItems: 'center', minWidth: 70 },
  colLabel: { fontFamily: fonts.medium, fontSize: 12, color: '#9CA3AF', marginBottom: 8 },
  colScroll: { maxHeight: 180 },
  colon: { fontFamily: fonts.bold, fontSize: 24, color: colors.inkBlack, marginTop: 28 },
  item: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginBottom: 4, alignItems: 'center' },
  itemSelected: { backgroundColor: colors.tealGreen },
  itemText: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack },
  itemTextSelected: { color: colors.mistWhite },
  confirmBtn: {
    backgroundColor: colors.careBlue, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})

// ─── Weekly calendar strip ────────────────────────────────────────────────────

function WeekStrip({ onDaySelect }: { onDaySelect: (weekday: number, date: Date) => void }) {
  const today = new Date()
  const [selectedDay, setSelectedDay] = useState(today.getDay() || 7)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (today.getDay() || 7) + i + 1)
    return { dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], date: d.getDate(), weekday: i + 1, dateObj: d }
  })

  return (
    <View style={weekStyles.strip}>
      {days.map((d) => {
        const isSelected = selectedDay === d.weekday
        const isToday = d.dateObj.toDateString() === today.toDateString()
        return (
          <Pressable key={d.dayName} onPress={() => { setSelectedDay(d.weekday); onDaySelect(d.weekday, d.dateObj) }} style={weekStyles.dayWrap}>
            {isSelected ? (
              <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={weekStyles.dayPill}>
                <Text style={[weekStyles.dayName, weekStyles.dayNameSelected]}>{d.dayName}</Text>
                <Text style={[weekStyles.dateNum, weekStyles.dateNumSelected]}>{d.date}</Text>
              </LinearGradient>
            ) : (
              <View style={weekStyles.dayPillInactive}>
                <Text style={weekStyles.dayName}>{d.dayName}</Text>
                <Text style={weekStyles.dateNum}>{d.date}</Text>
                {isToday && <View style={weekStyles.todayDot} />}
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const PENDING_MSG = 'Your account is under review. You cannot modify your schedule until admin approves you.'
const SUSPENDED_MSG = 'Your account has been suspended. Please contact support.'
const getStatusGateAlert = (status: string | null | undefined): [string, string] =>
  status === 'suspended' ? ['Account Suspended', SUSPENDED_MSG] : ['Account Under Review', PENDING_MSG]

export default function ScheduleScreen() {
  const { t } = useTranslation()
  const { user } = useUser()
  const { getToken } = useAuth()
  const { doctorStatus } = useDoctorStore()
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)
  const [acceptScheduled, setAcceptScheduled] = useState(true)
  const [acceptOnDemand, setAcceptOnDemand] = useState(true)
  const [blockedDates, setBlockedDates] = useState<string[]>([])
  const [savingAvailability, setSavingAvailability] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const { isOnline, setIsOnline, toggling: togglingOnline, toggle: toggleOnline } = useDoctorOnlineToggle(profileId)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loadingAppts, setLoadingAppts] = useState(true)
  const [timePicker, setTimePicker] = useState<{ day: DayKey; field: 'startTime' | 'endTime' } | null>(null)
  const [showBlockPicker, setShowBlockPicker] = useState(false)
  const [blockPickerDate, setBlockPickerDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })

  // Future days only (>= tomorrow) — today's live consultations are already
  // covered by Home's "Today's Schedule" widget, so including them here
  // duplicated them under "Upcoming Appointments" instead of keeping today
  // and upcoming visually separate. Re-run on Realtime changes (below) so a
  // newly-paid or rescheduled appointment appears without a manual refresh.
  const loadAppointments = async (client: ReturnType<typeof getAuthClient>, doctorProfileId: string) => {
    const tomorrowStart = new Date(new Date().setHours(0, 0, 0, 0))
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)
    const { data: appts } = await client
      .from('consultations')
      .select('id, type, scheduled_at, patient:users!consultations_patient_id_fkey(full_name)')
      .eq('doctor_id', doctorProfileId)
      .in('status', ['pending', 'active', 'scheduled'])
      .gte('scheduled_at', tomorrowStart.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(20)

    setAppointments(
      (appts ?? []).map((a: any) => {
        const { date, time } = formatApptDate(a.scheduled_at)
        return { id: a.id, patientName: a.patient?.full_name ?? 'Patient', date, time, type: a.type }
      })
    )
  }

  const scrollRef = useRef<ScrollView>(null)

  const applyAvailability = (availabilityJson: unknown) => {
    if (!availabilityJson) return
    const saved = availabilityJson as Record<string, any>
    const { blocked_dates, acceptScheduled: savedAcceptScheduled, acceptOnDemand: savedAcceptOnDemand, ...dayAvail } = saved
    setAvailability((prev) => ({ ...prev, ...dayAvail }))
    if (Array.isArray(blocked_dates)) setBlockedDates(blocked_dates)
    if (typeof savedAcceptScheduled === 'boolean') setAcceptScheduled(savedAcceptScheduled)
    if (typeof savedAcceptOnDemand === 'boolean') setAcceptOnDemand(savedAcceptOnDemand)
  }

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: me } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!me) return

        const { data: profile } = await client
          .from('doctor_profiles')
          .select('id, availability, is_online')
          .eq('user_id', (me as any).id)
          .maybeSingle()
        if (!profile) return
        setProfileId(profile.id)
        setIsOnline((profile as any).is_online ?? false)
        applyAvailability(profile.availability)

        await loadAppointments(client, profile.id)
      } finally {
        setLoadingAppts(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Live-sync availability/blocked-days edited from another device or the
  // website — without this, this screen only reflected what it itself last
  // saved until the next full app focus/reload.
  useEffect(() => {
    if (!profileId) return
    const channel = supabase
      .channel(`doctor-schedule-availability-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${profileId}` },
        (payload) => {
          const next = (payload.new as { availability?: unknown })?.availability
          if (next) applyAvailability(next)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profileId])

  // Live-refresh Upcoming Appointments whenever any of this doctor's
  // consultations change (new scheduled booking, reschedule, cancellation).
  useEffect(() => {
    if (!profileId) return
    const channel = supabase
      .channel(`doctor-schedule-${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${profileId}` },
        async () => {
          const token = await getToken()
          if (!token) return
          await loadAppointments(getAuthClient(token), profileId)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const toggleDay = (day: DayKey) =>
    setAvailability((prev) => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))

  const handleSaveAvailability = async () => {
    if (savingAvailability) return
    if (doctorStatus && doctorStatus !== 'approved') {
      Alert.alert(...getStatusGateAlert(doctorStatus))
      return
    }

    // Validate startTime < endTime for all enabled days
    for (const day of DAYS) {
      const avail = availability[day]
      if (!avail.enabled) continue
      const start = parseTime(avail.startTime)
      const end = parseTime(avail.endTime)
      const startMins = (start.period === 'PM' && start.hour !== 12 ? start.hour + 12 : start.period === 'AM' && start.hour === 12 ? 0 : start.hour) * 60 + start.minute
      const endMins = (end.period === 'PM' && end.hour !== 12 ? end.hour + 12 : end.period === 'AM' && end.hour === 12 ? 0 : end.hour) * 60 + end.minute
      if (startMins >= endMins) {
        Alert.alert('Invalid Time', `${day}: Start time must be before end time.`)
        return
      }
    }

    setSavingAvailability(true)
    try {
      if (!profileId) throw new Error('Doctor profile not found.')
      const token = await getToken()
      if (!token) throw new Error('Not authenticated.')
      const { data: updatedRows, error } = await getAuthClient(token)
        .from('doctor_profiles')
        .update({ availability: { ...availability, acceptScheduled, acceptOnDemand, blocked_dates: blockedDates } })
        .eq('id', profileId)
        .select('id')
      if (error) throw error
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('No doctor profile row matched — nothing was saved.')
      }
      await loadAppointments(getAuthClient(token), profileId)
      Alert.alert('Saved', 'Your availability has been updated.', [
        { text: 'OK', onPress: () => scrollRef.current?.scrollTo({ y: 0, animated: true }) },
      ])
    } catch {
      Alert.alert('Error', 'Could not save your availability. Please try again.')
    } finally {
      setSavingAvailability(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Text style={styles.headerTitle}>{t('myAvailability')}</Text>
      </LinearGradient>

      {timePicker && (
        <TimePickerModal
          visible
          label={timePicker.field === 'startTime' ? `${timePicker.day} — Start Time` : `${timePicker.day} — End Time`}
          initial={availability[timePicker.day][timePicker.field]}
          onConfirm={(time) => {
            setAvailability(prev => ({
              ...prev,
              [timePicker.day]: { ...prev[timePicker.day], [timePicker.field]: time },
            }))
            setTimePicker(null)
          }}
          onCancel={() => setTimePicker(null)}
        />
      )}

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Weekly strip */}
        <Text style={styles.sectionTitle}>{t('thisWeek')}</Text>
        <WeekStrip onDaySelect={() => {}} />

        {/* Availability status */}
        {!(doctorStatus && doctorStatus !== 'approved') && (
          <View style={[styles.availabilityCard, styles.onlineRow]}>
            <View style={styles.onlineDot}>
              <View style={[styles.onlineDotInner, { backgroundColor: isOnline ? colors.success : colors.steelGrey }]} />
            </View>
            <Text style={styles.onlineLabel}>{isOnline ? 'Online · Taking Patients' : 'Offline'}</Text>
            <Switch
              value={isOnline}
              onValueChange={toggleOnline}
              disabled={togglingOnline}
              trackColor={{ true: colors.success, false: colors.steelGrey }}
              thumbColor={colors.mistWhite}
            />
          </View>
        )}

        {/* Booking mode toggles */}
        <View style={styles.availabilityCard}>
          <View style={styles.modeRow}>
            <View style={styles.modeInfo}>
              <Text style={styles.modeTitle}>Accept Scheduled Appointments</Text>
              <Text style={styles.modeSub}>Let patients book in advance</Text>
            </View>
            <Switch
              value={acceptScheduled}
              onValueChange={setAcceptScheduled}
              trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
              thumbColor={colors.mistWhite}
            />
          </View>
          <View style={[styles.modeRow, styles.modeRowLast]}>
            <View style={styles.modeInfo}>
              <Text style={styles.modeTitle}>Accept On-Demand Consultations</Text>
              <Text style={styles.modeSub}>Let patients start an instant consultation right now</Text>
            </View>
            <Switch
              value={acceptOnDemand}
              onValueChange={setAcceptOnDemand}
              trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
              thumbColor={colors.mistWhite}
            />
          </View>
        </View>

        {/* Availability settings */}
        <View style={styles.availabilityCard}>
          <Text style={styles.availabilityTitle}>{t('setAvailableHours')}</Text>
          {DAYS.map((day) => {
            const avail = availability[day]
            return (
              <View key={day} style={styles.dayRow}>
                <Switch
                  value={avail.enabled}
                  onValueChange={() => toggleDay(day)}
                  trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
                  thumbColor={colors.mistWhite}
                  style={styles.daySwitch}
                />
                <Text style={[styles.dayName, !avail.enabled && styles.dayNameDisabled]}>{day}</Text>
                {avail.enabled ? (
                  <View style={styles.dayTimesRow}>
                    <Pressable onPress={() => setTimePicker({ day, field: 'startTime' })} style={styles.timeChip}>
                      <Text style={styles.timeChipText}>{avail.startTime}</Text>
                    </Pressable>
                    <Text style={styles.timeSep}>→</Text>
                    <Pressable onPress={() => setTimePicker({ day, field: 'endTime' })} style={styles.timeChip}>
                      <Text style={styles.timeChipText}>{avail.endTime}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.dayOff}>{t('off')}</Text>
                )}
              </View>
            )
          })}
        </View>

        {/* Save availability */}
        <GradientButton
          label={savingAvailability ? t('saving') : t('saveAvailability')}
          onPress={handleSaveAvailability}
          disabled={savingAvailability}
        />

        {/* Upcoming appointments — matches website: the week strip only
            highlights a day, it doesn't filter this list */}
        <Text style={[styles.sectionTitle, styles.mt8]}>{t('upcomingAppts')}</Text>
        {loadingAppts ? (
          <ActivityIndicator color={colors.careBlue} style={{ marginVertical: 20 }} />
        ) : appointments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={28} color={colors.steelGrey} />
            <Text style={styles.emptyText}>{t('noScheduledAppts')}</Text>
          </View>
        ) : (
          appointments.map((appt) => (
            <View key={appt.id} style={styles.apptCard}>
              <View style={[styles.apptLeft, { backgroundColor: `${TYPE_COLORS[appt.type]}18` }]}>
                <Ionicons name={TYPE_ICONS[appt.type]} size={21} color={TYPE_COLORS[appt.type]} />
              </View>
              <View style={styles.apptInfo}>
                <Text style={styles.apptPatient}>{appt.patientName}</Text>
                <Text style={styles.apptTime}>{appt.date} · {appt.time}</Text>
              </View>
              <View style={styles.apptStatusBadge}>
                <Text style={styles.apptStatusText}>Upcoming</Text>
              </View>
            </View>
          ))
        )}

        {/* Block dates section */}
        <Text style={[styles.sectionTitle, styles.mt8]}>{t('blockedDates')}</Text>
        <View style={styles.availabilityCard}>
          <Text style={styles.blockDatesSub}>Patients cannot book you on blocked dates.</Text>

          {blockedDates.length > 0 && (
            <View style={{ gap: 8, marginBottom: 12 }}>
              {blockedDates.sort().map(dateStr => (
                <View key={dateStr} style={styles.blockedDateRow}>
                  <Text style={styles.blockedDateText}>
                    {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Pressable
                    onPress={() => setBlockedDates(prev => prev.filter(d => d !== dateStr))}
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeDateBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.error} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={handleSaveAvailability}
                disabled={savingAvailability}
                style={({ pressed }) => [styles.saveBlockedBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.saveBlockedText}>{savingAvailability ? t('saving') : 'Save Changes'}</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.blockTimeBtn, pressed && { opacity: 0.85 }]}
            onPress={() => {
              if (doctorStatus && doctorStatus !== 'approved') {
                Alert.alert(...getStatusGateAlert(doctorStatus))
              } else {
                setShowBlockPicker(true)
              }
            }}
          >
            <Ionicons name="ban-outline" size={18} color={colors.error} />
            <Text style={styles.blockTimeBtnText}>Block a Date</Text>
          </Pressable>
        </View>

        {/* Block date picker modal */}
        <Modal visible={showBlockPicker} transparent animationType="slide" onRequestClose={() => setShowBlockPicker(false)}>
          <View style={tpStyles.overlay}>
            <Pressable style={tpStyles.backdrop} onPress={() => setShowBlockPicker(false)} />
            <View style={tpStyles.sheet}>
              <View style={tpStyles.handle} />
              <Text style={tpStyles.title}>Block a Date</Text>
              <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
                Enter a date to make unavailable for patient bookings.
              </Text>
              <TextInput
                style={{
                  height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.steelGrey,
                  paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack,
                  backgroundColor: colors.cloudGrey, marginBottom: 20,
                }}
                value={blockPickerDate}
                onChangeText={setBlockPickerDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                maxLength={10}
              />
              <Pressable
                onPress={() => {
                  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
                  if (!dateRegex.test(blockPickerDate)) {
                    Alert.alert('Invalid Date', 'Please enter a date in YYYY-MM-DD format.')
                    return
                  }
                  const d = new Date(blockPickerDate + 'T12:00:00')
                  if (isNaN(d.getTime())) { Alert.alert('Invalid Date', 'That date is not valid.'); return }
                  if (d < new Date(new Date().setHours(0,0,0,0))) { Alert.alert('Past Date', 'You can only block future dates.'); return }
                  if (!blockedDates.includes(blockPickerDate)) {
                    const previous = blockedDates
                    const updated = [...blockedDates, blockPickerDate]
                    setBlockedDates(updated)
                    getToken().then(async token => {
                      if (!token || !profileId) { setBlockedDates(previous); return }
                      const { data: updatedRows, error } = await getAuthClient(token)
                        .from('doctor_profiles')
                        .update({ availability: { ...availability, acceptScheduled, acceptOnDemand, blocked_dates: updated } })
                        .eq('id', profileId)
                        .select('id')
                      if (error || !updatedRows || updatedRows.length === 0) {
                        setBlockedDates(previous)
                        Alert.alert('Error', 'Could not block this date. Please try again.')
                      }
                    })
                  }
                  setShowBlockPicker(false)
                }}
                style={tpStyles.confirmBtn}
              >
                <Text style={tpStyles.confirmText}>Block This Date</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const weekStyles = StyleSheet.create({
  strip: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginBottom: 16 },
  dayWrap: { flex: 1, alignItems: 'center' },
  dayPill: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', width: 42 },
  dayPillInactive: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', width: 42, gap: 2 },
  dayName: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280' },
  dayNameSelected: { color: colors.mistWhite, fontFamily: fonts.semiBold },
  dateNum: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, marginTop: 4 },
  dateNumSelected: { color: colors.mistWhite },
  todayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.tealGreen, marginTop: 3 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 12 },
  mt8: { marginTop: 8 },

  availabilityCard: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, ...shadow('#000', 0, 1, 4, 0.05, 1) },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlineDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  onlineDotInner: { width: 10, height: 10, borderRadius: 5 },
  onlineLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, flex: 1 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  modeRowLast: { borderBottomWidth: 0, paddingBottom: 0, paddingTop: 14 },
  modeInfo: { flex: 1, paddingRight: 12 },
  modeTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  modeSub: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },
  availabilityTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, marginBottom: 12 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, gap: 12 },
  daySwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] },
  dayName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, width: 36 },
  dayNameDisabled: { color: '#9CA3AF' },
  dayHours: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', flex: 1 },
  dayOff: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF', flex: 1 },
  dayTimesRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  timeChip: {
    borderWidth: 1, borderColor: colors.steelGrey,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: colors.cloudGrey,
  },
  timeChipText: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkBlack },
  timeSep: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },

  apptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  apptLeft: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  apptIcon: { fontSize: 20 },
  apptInfo: { flex: 1 },
  apptPatient: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  apptTime: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  apptStatusBadge: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  apptStatusText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.interactiveBlue },

  emptyCard: {
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 24,
    alignItems: 'center', gap: 8, marginBottom: 10,
  },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF' },

  blockTimeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1.5, borderColor: colors.error, borderRadius: 16, paddingVertical: 14,
    backgroundColor: '#FFF5F5', marginTop: 4,
  },
  blockTimeBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.error },
  blockDatesSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 12 },
  blockedDateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  blockedDateText: { fontFamily: fonts.medium, fontSize: 14, color: colors.error },
  removeDateBtn: { padding: 2 },
  saveBlockedBtn: {
    backgroundColor: colors.careBlue, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 4,
  },
  saveBlockedText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
})
