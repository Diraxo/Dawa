import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import {
  SLOT_DURATION_MINS,
  formatTimeMins,
  isSlotPast,
  getAvailableSlots,
  getNextDays,
  parseScheduledAt,
  type Availability,
} from '@/lib/slotGeneration'

type ConsultationType = 'chat' | 'phone' | 'video'

export interface RescheduleAppointment {
  id: string
  doctorId: string
  doctorName: string
  type: ConsultationType
  scheduledAt: string
}

type Props = {
  visible: boolean
  appointment: RescheduleAppointment | null
  onClose: () => void
  onRescheduled: (newScheduledAt: string) => void
}

const TYPE_LABEL: Record<ConsultationType, string> = {
  chat: 'Chat Consultation', phone: 'Phone Call', video: 'Video Call',
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

export function RescheduleModal({ visible, appointment, onClose, onRescheduled }: Props) {
  const { getToken } = useAuth()
  const slideAnim = useRef(new Animated.Value(300)).current
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loadingAvail, setLoadingAvail] = useState(false)
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [bookedTimes, setBookedTimes] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const days = getNextDays(14, availability ?? undefined)
  const selectedDayValue = days[selectedDay]?.value

  useEffect(() => {
    if (visible) {
      setSelectedDay(0)
      setSelectedTime('')
      setAvailability(null)
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
    } else {
      Animated.timing(slideAnim, { toValue: 300, duration: 220, useNativeDriver: true }).start()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    if (!visible || !appointment) return
    let cancelled = false
    setLoadingAvail(true)
    supabase
      .from('doctor_profiles')
      .select('availability')
      .eq('id', appointment.doctorId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setAvailability((data as any)?.availability ?? null)
        setLoadingAvail(false)
      })
    return () => { cancelled = true }
  }, [visible, appointment?.doctorId])

  // Which generated time slots for the selected day are already booked —
  // same source of truth (slot_locks) as BookingModal.
  useEffect(() => {
    if (!visible || !appointment || !selectedDayValue) {
      setBookedTimes(new Set())
      return
    }
    let cancelled = false
    const dayStart = new Date(`${selectedDayValue}T00:00:00`)
    const dayEnd = new Date(`${selectedDayValue}T23:59:59.999`)
    supabase
      .from('slot_locks')
      .select('slot_start')
      .eq('doctor_id', appointment.doctorId)
      .gte('slot_start', dayStart.toISOString())
      .lte('slot_start', dayEnd.toISOString())
      .gt('expires_at', new Date().toISOString())
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) { setBookedTimes(new Set()); return }
        setBookedTimes(new Set(
          data.map((row: any) => {
            const d = new Date(row.slot_start)
            return formatTimeMins(d.getHours() * 60 + d.getMinutes())
          })
        ))
      })
    return () => { cancelled = true }
  }, [visible, appointment?.doctorId, selectedDayValue])

  const slots = availability ? getAvailableSlots(availability, selectedDayValue ?? '') : []

  const handleConfirm = () => {
    if (!appointment || !selectedTime || !selectedDayValue) return
    const dayLabel = days[selectedDay].label
    Alert.alert(
      'Confirm Reschedule',
      `Move this appointment to ${dayLabel} at ${selectedTime}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: submitReschedule },
      ],
    )
  }

  const submitReschedule = async () => {
    if (!appointment || !selectedTime || !selectedDayValue || submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated. Please try again.')
      const client = getAuthClient(token)
      const newSlotStart = parseScheduledAt(selectedDayValue, selectedTime)

      const { error } = await withTimeout(
        client.rpc('reschedule_appointment_slot', {
          p_consultation_id: appointment.id,
          p_new_slot_start:  newSlotStart,
        }),
        15000,
        'Reschedule request timed out. Please check your connection and try again.',
      )

      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('SLOT_TAKEN')) {
          throw new Error('This time slot was just booked by someone else. Please pick another time.')
        }
        if (msg.includes('SCHEDULED_DISABLED')) {
          throw new Error('This doctor is not accepting scheduled appointments right now.')
        }
        if (msg.includes('DAY_OFF')) {
          throw new Error('This doctor is not available on the selected day.')
        }
        if (msg.includes('DATE_BLOCKED')) {
          throw new Error('This doctor is unavailable on the selected date.')
        }
        if (msg.includes('OUTSIDE_HOURS')) {
          throw new Error('This time is outside the doctor\'s working hours. Please pick another time.')
        }
        if (msg.includes('INVALID_STATUS')) {
          throw new Error('This appointment can no longer be rescheduled.')
        }
        throw new Error('Failed to reschedule. Please try again.')
      }

      onRescheduled(newSlotStart)
      onClose()
    } catch (e: any) {
      Alert.alert('Reschedule Failed', e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!appointment) return null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Reschedule Appointment</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.inkBlack} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            {appointment.doctorName} · {TYPE_LABEL[appointment.type]}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {loadingAvail ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color={colors.careBlue} />
            ) : (
              <>
                <Text style={styles.pickerLabel}>Select Date</Text>
                {days.length === 0 ? (
                  <View style={styles.noSlotsWrap}>
                    <Text style={styles.noSlotsText}>No available dates in the next two weeks.</Text>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
                    {days.map((day, idx) => (
                      <Pressable
                        key={day.value}
                        onPress={() => { setSelectedDay(idx); setSelectedTime('') }}
                        style={[styles.dayChip, selectedDay === idx && styles.dayChipSelected]}
                      >
                        <Text style={[styles.dayText, selectedDay === idx && styles.dayTextSelected]}>
                          {day.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                {days.length > 0 && (
                  <>
                    <Text style={styles.pickerLabel}>Select Time</Text>
                    {slots.length === 0 ? (
                      <View style={styles.noSlotsWrap}>
                        <Text style={styles.noSlotsText}>No time slots available for this day.</Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.legendRow}>
                          <View style={styles.legendItem}>
                            <View style={[styles.legendSwatch, styles.legendSwatchAvailable]} />
                            <Text style={styles.legendText}>Available</Text>
                          </View>
                          <View style={styles.legendItem}>
                            <View style={[styles.legendSwatch, styles.legendSwatchBooked]} />
                            <Text style={styles.legendText}>Booked</Text>
                          </View>
                        </View>
                        <View style={styles.timeGrid}>
                          {slots.map(slot => {
                            const isBooked = bookedTimes.has(slot)
                            const isPast = !isBooked && isSlotPast(selectedDayValue ?? '', slot)
                            return (
                              <Pressable
                                key={slot}
                                onPress={() => setSelectedTime(slot)}
                                disabled={isBooked || isPast}
                                style={[
                                  styles.timeChip,
                                  selectedTime === slot && styles.timeChipSelected,
                                  isBooked && styles.timeChipDisabled,
                                  isPast && styles.timeChipPast,
                                ]}
                              >
                                <Text style={[
                                  styles.timeText,
                                  selectedTime === slot && styles.timeTextSelected,
                                  (isBooked || isPast) && styles.timeTextDisabled,
                                ]}>
                                  {slot}
                                </Text>
                              </Pressable>
                            )
                          })}
                        </View>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.cancelButton} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, (!selectedTime || submitting) && styles.confirmButtonDisabled]}
              onPress={handleConfirm}
              disabled={!selectedTime || submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.mistWhite} />
                : <Text style={styles.confirmButtonText}>Confirm New Time</Text>}
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20, maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 16 },
  pickerLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 8, marginTop: 8 },
  noSlotsWrap: { paddingVertical: 12 },
  noSlotsText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280' },
  dayScroll: { marginBottom: 12 },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    marginRight: 8, backgroundColor: colors.mistWhite,
  },
  dayChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  dayText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  dayTextSelected: { color: colors.mistWhite },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5 },
  legendSwatchAvailable: { borderColor: colors.success, backgroundColor: 'rgba(0,203,83,0.12)' },
  legendSwatchBooked: { borderColor: colors.error, backgroundColor: 'rgba(211,47,47,0.12)' },
  legendText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  timeChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.success, backgroundColor: 'rgba(0,203,83,0.08)',
  },
  timeChipSelected: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  timeChipDisabled: { borderColor: colors.error, backgroundColor: 'rgba(211,47,47,0.08)', opacity: 0.7 },
  timeChipPast: { borderColor: colors.steelGrey, backgroundColor: 'rgba(212,217,225,0.3)', opacity: 0.6 },
  timeText: { fontFamily: fonts.medium, fontSize: 13, color: '#374151' },
  timeTextSelected: { color: colors.mistWhite },
  timeTextDisabled: { color: '#9CA3AF' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 16 },
  cancelButton: {
    flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.steelGrey,
  },
  cancelButtonText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#374151' },
  confirmButton: {
    flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    backgroundColor: colors.careBlue,
  },
  confirmButtonDisabled: { opacity: 0.5 },
  confirmButtonText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
})
