import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useRef, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { Doctor } from '@/components/ui/DoctorCard'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { getAuthClient } from '@/lib/supabase'

type ConsultationType = 'chat' | 'phone' | 'video'
type TimingType = 'now' | 'schedule'

type Props = {
  visible: boolean
  doctor: Doctor | null
  onClose: () => void
}

const CONSULT_TYPES: { id: ConsultationType; label: string; icon: string; color: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'chatbubble-ellipses', color: colors.tealGreen },
  { id: 'phone', label: 'Phone Call', icon: 'call', color: colors.careBlue },
  { id: 'video', label: 'Video Call', icon: 'videocam', color: '#7C3AED' },
]

const TIME_SLOTS = ['09:00 AM', '10:00 AM', '11:00 AM', '02:00 PM', '03:00 PM', '04:00 PM']

function getNextDays(count: number) {
  const days = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      value: d.toISOString().split('T')[0],
    })
  }
  return days
}

function parseScheduledAt(dayValue: string, timeSlot: string): string {
  const [timePart, meridiem] = timeSlot.split(' ')
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)
  if (meridiem === 'PM' && hour !== 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  return `${dayValue}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
}

export function BookingModal({ visible, doctor, onClose }: Props) {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const slideAnim = useRef(new Animated.Value(300)).current
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [consultType, setConsultType] = useState<ConsultationType>('chat')
  const [timing, setTiming] = useState<TimingType>('now')
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [confirming, setConfirming] = useState(false)
  const days = getNextDays(7)

  useEffect(() => {
    if (visible) {
      setStep(1)
      setConsultType('chat')
      setTiming('now')
      setSelectedDay(0)
      setSelectedTime('')
      setConfirming(false)
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
    } else {
      Animated.timing(slideAnim, { toValue: 300, duration: 220, useNativeDriver: true }).start()
    }
  }, [visible])

  if (!doctor) return null

  const getPrice = (type: ConsultationType) => {
    if (type === 'chat') return doctor.chat_price
    if (type === 'phone') return doctor.phone_price
    return doctor.video_price
  }

  const selectedType = CONSULT_TYPES.find(t => t.id === consultType)!

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const token = await getToken()
      if (!token || !user) throw new Error('Not authenticated')

      const client = getAuthClient(token)

      // Resolve the patient's users.id from their Clerk ID
      const { data: userData, error: userErr } = await client
        .from('users')
        .select('id')
        .eq('clerk_id', user.id)
        .single()

      if (userErr || !userData) throw new Error('Could not find your user profile.')

      const scheduledAt = timing === 'now'
        ? new Date().toISOString()
        : parseScheduledAt(days[selectedDay].value, selectedTime)

      const price = getPrice(consultType)

      const { data: consultation, error: consultErr } = await client
        .from('consultations')
        .insert({
          patient_id: userData.id,
          doctor_id: doctor.id,
          type: consultType,
          status: 'pending',
          scheduled_at: scheduledAt,
          patient_amount: price,
          doctor_amount: Math.round(price * 0.8),
          platform_amount: Math.round(price * 0.2),
          payment_status: 'pending',
        })
        .select('id')
        .single()

      if (consultErr || !consultation) throw new Error('Failed to create consultation. Please try again.')

      onClose()
      if (timing === 'now') {
        router.push({
          pathname: '/(patient)/waiting-room',
          params: {
            consultationId: consultation.id,
            doctorId: doctor.id,
            doctorName: doctor.name,
            consultationType: consultType,
          },
        })
      } else {
        Alert.alert(
          'Appointment Scheduled',
          `Your ${selectedType.label} consultation with ${doctor.name} has been scheduled for ${days[selectedDay].label} at ${selectedTime}.`,
          [{ text: 'OK' }]
        )
      }
    } catch (err: any) {
      Alert.alert('Booking Failed', err?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  const canGoNext = () => {
    if (step === 2 && timing === 'schedule') return selectedTime !== ''
    return true
  }

  const handleNext = () => {
    if (step === 1) setStep(2)
    else if (step === 2) setStep(3)
    else handleConfirm()
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Book Consultation</Text>
            <Text style={styles.doctorName}>{doctor.name}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </Pressable>
        </View>

        {/* Step indicators */}
        <View style={styles.stepRow}>
          {[1, 2, 3].map(s => (
            <View key={s} style={[styles.stepDot, step >= s && styles.stepDotActive]} />
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.body}>
          {/* ── Step 1: Choose consultation type ── */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>Choose Consultation Type</Text>
              {CONSULT_TYPES.map(type => (
                <Pressable
                  key={type.id}
                  style={[styles.typeCard, consultType === type.id && styles.typeCardSelected]}
                  onPress={() => setConsultType(type.id)}
                >
                  <View style={[styles.typeIconWrap, { backgroundColor: `${type.color}18` }]}>
                    <Ionicons name={type.icon as any} size={24} color={type.color} />
                  </View>
                  <View style={styles.typeInfo}>
                    <Text style={styles.typeLabel}>{type.label}</Text>
                    <Text style={styles.typePrice}>ETB {getPrice(type.id)}</Text>
                  </View>
                  <View style={[styles.radioOuter, consultType === type.id && styles.radioSelected]}>
                    {consultType === type.id && <View style={styles.radioInner} />}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* ── Step 2: Choose timing ── */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>When do you want to consult?</Text>
              <View style={styles.timingRow}>
                <Pressable
                  style={[styles.timingCard, timing === 'now' && styles.timingCardSelected]}
                  onPress={() => setTiming('now')}
                >
                  <Ionicons name="flash" size={22} color={timing === 'now' ? colors.mistWhite : colors.tealGreen} />
                  <Text style={[styles.timingLabel, timing === 'now' && styles.timingLabelSelected]}>On-Demand</Text>
                  <Text style={[styles.timingSub, timing === 'now' && styles.timingSubSelected]}>Start Now</Text>
                </Pressable>
                <Pressable
                  style={[styles.timingCard, timing === 'schedule' && styles.timingCardSelected]}
                  onPress={() => setTiming('schedule')}
                >
                  <Ionicons name="calendar" size={22} color={timing === 'schedule' ? colors.mistWhite : colors.careBlue} />
                  <Text style={[styles.timingLabel, timing === 'schedule' && styles.timingLabelSelected]}>Schedule</Text>
                  <Text style={[styles.timingSub, timing === 'schedule' && styles.timingSubSelected]}>Pick a time</Text>
                </Pressable>
              </View>

              {timing === 'schedule' && (
                <>
                  <Text style={styles.pickerLabel}>Select Date</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
                    {days.map((day, idx) => (
                      <Pressable
                        key={day.value}
                        onPress={() => setSelectedDay(idx)}
                        style={[styles.dayChip, selectedDay === idx && styles.dayChipSelected]}
                      >
                        <Text style={[styles.dayText, selectedDay === idx && styles.dayTextSelected]}>
                          {day.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <Text style={styles.pickerLabel}>Select Time</Text>
                  <View style={styles.timeGrid}>
                    {TIME_SLOTS.map(slot => (
                      <Pressable
                        key={slot}
                        onPress={() => setSelectedTime(slot)}
                        style={[styles.timeChip, selectedTime === slot && styles.timeChipSelected]}
                      >
                        <Text style={[styles.timeText, selectedTime === slot && styles.timeTextSelected]}>
                          {slot}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepLabel}>Review & Confirm</Text>
              <View style={styles.summaryCard}>
                <Row label="Doctor" value={doctor.name} />
                <Row label="Type" value={selectedType.label} />
                <Row label="Timing" value={timing === 'now' ? 'On-Demand (Now)' : `${days[selectedDay].label} at ${selectedTime}`} />
                <View style={styles.summaryDivider} />
                <Row label="Consultation Fee" value={`ETB ${getPrice(consultType)}`} bold />
                <Row label="Platform Fee" value="ETB 10" />
                <View style={styles.summaryDivider} />
                <Row label="Total" value={`ETB ${getPrice(consultType) + 10}`} bold teal />
              </View>
              <View style={styles.noticeCard}>
                <Ionicons name="information-circle" size={18} color={colors.information} />
                <Text style={styles.noticeText}>
                  Payment integration is coming soon. Your booking will be confirmed once payment is available.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* CTA Button */}
        <View style={styles.footer}>
          {step > 1 && (
            <Pressable
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}
              onPress={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              disabled={confirming}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleNext}
            disabled={!canGoNext() || confirming}
            style={({ pressed }) => [styles.nextBtnWrap, pressed && { opacity: 0.88 }, (!canGoNext() || confirming) && styles.btnDisabled]}
          >
            <LinearGradient
              colors={gradients.interactive}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextBtn}
            >
              {confirming ? (
                <ActivityIndicator color={colors.mistWhite} />
              ) : (
                <Text style={styles.nextBtnText}>
                  {step === 3 ? (timing === 'now' ? 'Confirm & Find Doctor' : 'Schedule Appointment') : 'Continue →'}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  )
}

function Row({ label, value, bold, teal }: { label: string; value: string; bold?: boolean; teal?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryBold, teal && styles.summaryTeal]}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.steelGrey,
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  doctorName: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  stepRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginBottom: 4 },
  stepDot: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.cloudGrey,
  },
  stepDotActive: { backgroundColor: colors.tealGreen },
  body: { paddingHorizontal: 20 },
  stepContent: { paddingBottom: 20 },
  stepLabel: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, marginBottom: 16 },

  // Consult type cards
  typeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 14, marginBottom: 10, backgroundColor: colors.mistWhite,
  },
  typeCardSelected: { borderColor: colors.tealGreen, backgroundColor: '#F0FDFB' },
  typeIconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typeInfo: { flex: 1 },
  typeLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  typePrice: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.tealGreen },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.tealGreen },

  // Timing
  timingRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  timingCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 18, alignItems: 'center', gap: 6,
  },
  timingCardSelected: { borderColor: colors.tealGreen, backgroundColor: colors.tealGreen },
  timingLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  timingLabelSelected: { color: colors.mistWhite },
  timingSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  timingSubSelected: { color: 'rgba(255,255,255,0.8)' },

  // Schedule pickers
  pickerLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 10 },
  dayScroll: { marginBottom: 20 },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    marginRight: 8, backgroundColor: colors.mistWhite,
  },
  dayChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  dayText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  dayTextSelected: { color: colors.mistWhite },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.steelGrey, backgroundColor: colors.mistWhite,
  },
  timeChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  timeText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  timeTextSelected: { color: colors.mistWhite },

  // Summary
  summaryCard: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 16, gap: 12, marginBottom: 14,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  summaryValue: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
  summaryBold: { fontFamily: fonts.bold },
  summaryTeal: { color: colors.tealGreen },
  summaryDivider: { height: 1, backgroundColor: colors.cloudGrey },

  // Notice
  noticeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14,
  },
  noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#1E40AF', lineHeight: 20 },

  // Footer
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16 },
  backBtn: {
    height: 52, paddingHorizontal: 20, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  nextBtnWrap: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  nextBtn: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  nextBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  btnDisabled: { opacity: 0.5 },
})
