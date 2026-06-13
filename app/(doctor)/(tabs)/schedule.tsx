import { useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GradientButton } from '@/components/ui/GradientButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { supabase } from '@/lib/supabase'

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

const TYPE_ICONS = { chat: '💬', phone: '📞', video: '🎥' }

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

// ─── Weekly calendar strip ────────────────────────────────────────────────────

function WeekStrip() {
  const today = new Date()
  const [selectedDay, setSelectedDay] = useState(today.getDay())

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - today.getDay() + i + 1)
    return { dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], date: d.getDate(), weekday: i + 1 }
  })

  return (
    <View style={weekStyles.strip}>
      {days.map((d) => {
        const isSelected = selectedDay === d.weekday
        const isToday = d.weekday === today.getDay() || (today.getDay() === 0 && d.weekday === 7)
        return (
          <Pressable key={d.dayName} onPress={() => setSelectedDay(d.weekday)} style={weekStyles.dayWrap}>
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

export default function ScheduleScreen() {
  const { user } = useUser()
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)
  const [acceptScheduled, setAcceptScheduled] = useState(true)
  const [onDemandOnly, setOnDemandOnly] = useState(false)
  const [savingAvailability, setSavingAvailability] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loadingAppts, setLoadingAppts] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const { data: profile } = await supabase
          .from('doctor_profiles')
          .select('id, availability, user:users!inner(clerk_id)')
          .eq('users.clerk_id', user.id)
          .maybeSingle()
        if (!profile) return
        setProfileId(profile.id)
        if (profile.availability) {
          const saved = profile.availability as Record<string, DayAvailability>
          setAvailability((prev) => ({ ...prev, ...saved }))
        }

        const { data: appts } = await supabase
          .from('consultations')
          .select('id, type, scheduled_at, patient:users!consultations_patient_id_fkey(full_name)')
          .eq('doctor_id', profile.id)
          .in('status', ['pending', 'active'])
          .gte('scheduled_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(20)

        setAppointments(
          (appts ?? []).map((a: any) => {
            const { date, time } = formatApptDate(a.scheduled_at)
            return { id: a.id, patientName: a.patient?.full_name ?? 'Patient', date, time, type: a.type }
          })
        )
      } finally {
        setLoadingAppts(false)
      }
    })()
  }, [user?.id])

  const toggleDay = (day: DayKey) =>
    setAvailability((prev) => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))

  const handleSaveAvailability = async () => {
    if (savingAvailability) return
    setSavingAvailability(true)
    try {
      if (!profileId) throw new Error('Doctor profile not found.')
      const { error } = await supabase
        .from('doctor_profiles')
        .update({ availability })
        .eq('id', profileId)
      if (error) throw error
      Alert.alert('Saved', 'Your availability has been updated.')
    } catch {
      Alert.alert('Error', 'Could not save your availability. Please try again.')
    } finally {
      setSavingAvailability(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Text style={styles.headerTitle}>My Schedule</Text>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Mode toggles */}
        <View style={styles.modeCard}>
          <View style={styles.modeRow}>
            <View style={styles.modeLeft}>
              <Ionicons name="calendar-outline" size={18} color={colors.careBlue} />
              <Text style={styles.modeLabel}>Accept Scheduled Appointments</Text>
            </View>
            <Switch
              value={acceptScheduled}
              onValueChange={setAcceptScheduled}
              trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
              thumbColor={colors.mistWhite}
            />
          </View>
          <View style={styles.modeDivider} />
          <View style={styles.modeRow}>
            <View style={styles.modeLeft}>
              <Ionicons name="flash-outline" size={18} color={colors.interactiveBlue} />
              <Text style={styles.modeLabel}>On-Demand Only</Text>
            </View>
            <Switch
              value={onDemandOnly}
              onValueChange={setOnDemandOnly}
              trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
              thumbColor={colors.mistWhite}
            />
          </View>
        </View>

        {/* Weekly strip */}
        <Text style={styles.sectionTitle}>This Week</Text>
        <WeekStrip />

        {/* Availability settings */}
        <View style={styles.availabilityCard}>
          <Text style={styles.availabilityTitle}>Set Your Available Hours</Text>
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
                  <Text style={styles.dayHours}>{avail.startTime} → {avail.endTime}</Text>
                ) : (
                  <Text style={styles.dayOff}>Off</Text>
                )}
              </View>
            )
          })}
        </View>

        {/* Save availability */}
        <GradientButton
          label={savingAvailability ? 'Saving...' : 'Save Availability'}
          onPress={handleSaveAvailability}
          disabled={savingAvailability}
        />

        {/* Upcoming appointments */}
        <Text style={[styles.sectionTitle, styles.mt8]}>Upcoming Appointments</Text>
        {loadingAppts ? (
          <ActivityIndicator color={colors.careBlue} style={{ marginVertical: 20 }} />
        ) : appointments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={28} color={colors.steelGrey} />
            <Text style={styles.emptyText}>No upcoming appointments</Text>
          </View>
        ) : (
          appointments.map((appt) => (
            <View key={appt.id} style={styles.apptCard}>
              <View style={styles.apptLeft}>
                <Text style={styles.apptIcon}>{TYPE_ICONS[appt.type]}</Text>
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

        {/* Block time */}
        <Pressable style={styles.blockTimeBtn}>
          <Ionicons name="ban-outline" size={18} color={colors.error} />
          <Text style={styles.blockTimeBtnText}>Block Time Slot</Text>
        </Pressable>

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

  modeCard: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  modeLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack, flex: 1 },
  modeDivider: { height: 1, backgroundColor: colors.cloudGrey, marginVertical: 12 },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 12 },
  mt8: { marginTop: 8 },

  availabilityCard: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  availabilityTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, marginBottom: 12 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, gap: 12 },
  daySwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] },
  dayName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, width: 36 },
  dayNameDisabled: { color: '#9CA3AF' },
  dayHours: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', flex: 1 },
  dayOff: { fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF', flex: 1 },

  apptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  apptLeft: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: '#FFF5F5', marginTop: 8,
  },
  blockTimeBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.error },
})
