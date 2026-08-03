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
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useServerNow } from '@/lib/serverClock'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import {
  SLOT_DURATION_MINS,
  isSlotPast,
  getAvailableSlots,
  getNextDays,
  parseScheduledAt,
  ethiopiaDayRange,
  formatSlotFromIso,
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
  const insets = useSafeAreaInsets()
  const { getToken } = useAuth()
  const slideAnim = useRef(new Animated.Value(300)).current
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loadingAvail, setLoadingAvail] = useState(false)
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [bookedTimes, setBookedTimes] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  // Device-clock-independent "now", synced against Postgres' own now() —
  // mirrors the identical fix in BookingModal (see lib/serverClock.ts).
  const nowMs = useServerNow()
  const days = getNextDays(14, availability ?? undefined, nowMs)
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
    const doctorId = appointment.doctorId
    supabase
      .from('doctor_profiles')
      .select('availability')
      .eq('id', doctorId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setAvailability((data as any)?.availability ?? null)
        setLoadingAvail(false)
      })

    // Doctor editing working hours/blocked dates while this sheet is open
    // must update the offered dates/slots live — this modal previously
    // fetched availability once and never picked up a schedule change until
    // re-opened, unlike BookingModal's parent-fed live doctor prop. Stable
    // per-doctor topic through the shared ref-counted manager (not a
    // Date.now()-suffixed one-off channel) — Phase-4 audit M9.
    const unsubscribe = subscribeRealtime(
      `reschedule-doctor-availability:${doctorId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorId}` }],
      (_event, payload) => {
        if (cancelled) return
        setAvailability((payload.new as any)?.availability ?? null)
      },
    )

    return () => { cancelled = true; unsubscribe() }
  }, [visible, appointment?.doctorId])

  // Which generated time slots for the selected day are already booked —
  // same source of truth (slot_locks) as BookingModal.
  useEffect(() => {
    if (!visible || !appointment || !selectedDayValue) {
      setBookedTimes(new Set())
      return
    }
    let cancelled = false
    // Ethiopia-anchored bounds, not device-local `T00:00:00` — matches
    // BookingModal's identical fix (Phase-4 audit M2).
    const { startIso: dayStartIso, endIso: dayEndIso } = ethiopiaDayRange(selectedDayValue)

    const fetchBookedTimes = () => {
      supabase
        .from('slot_locks')
        .select('slot_start')
        .eq('doctor_id', appointment.doctorId)
        .gte('slot_start', dayStartIso)
        .lt('slot_start', dayEndIso)
        .gt('expires_at', new Date().toISOString())
        .then(({ data, error }) => {
          if (cancelled) return
          if (error || !data) { setBookedTimes(new Set()); return }
          setBookedTimes(new Set(
            data.map((row: any) => formatSlotFromIso(row.slot_start))
          ))
        })
    }

    fetchBookedTimes()

    // Another patient booking/cancelling the same day while this sheet is
    // open must flip that slot's availability live — mirrors BookingModal's
    // identical subscription (this modal previously fetched once and never
    // updated until re-opened). Shared ref-counted manager (not a raw
    // supabase.channel()) so a same-tick unmount+remount for the same
    // doctor/day (day-picker tap back-and-forth) reuses the still-live
    // channel instead of racing removeChannel()'s async unsubscribe —
    // Phase-4 audit M9.
    const unsubscribe = subscribeRealtime(
      `reschedule-slot-locks:${appointment.doctorId}:${selectedDayValue}`,
      [{ event: '*', schema: 'public', table: 'slot_locks', filter: `doctor_id=eq.${appointment.doctorId}` }],
      () => fetchBookedTimes(),
    )

    return () => { cancelled = true; unsubscribe() }
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={submitting ? undefined : onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={submitting ? undefined : onClose} />
        <Animated.View style={[styles.sheet, { paddingBottom: 12 + insets.bottom, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Reschedule Appointment</Text>
            <Pressable onPress={submitting ? undefined : onClose} hitSlop={10} disabled={submitting}>
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
                        <Text style={styles.noSlotsText}>Doctor is not available on this day.</Text>
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
                            const isPast = !isBooked && isSlotPast(selectedDayValue ?? '', slot, nowMs)
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
  // paddingBottom is overridden inline with the device safe-area inset added — see JSX.
  sheet: {
    backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, maxHeight: '85%',
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
