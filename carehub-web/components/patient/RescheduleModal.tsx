'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useServerNow } from '@/lib/serverClock'
import {
  isSlotPast,
  getAvailableSlots,
  getNextDays,
  parseScheduledAt,
  type Availability,
} from '@/lib/slotGeneration'
import { X } from 'lucide-react'

export interface RescheduleAppointment {
  id: string
  doctorId: string
  doctorName: string
  type: string
  scheduledAt: string
}

type Props = {
  appointment: RescheduleAppointment | null
  onClose: () => void
  onRescheduled: (newScheduledAt: string) => void
}

const TYPE_LABEL: Record<string, string> = {
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

export function RescheduleModal({ appointment, onClose, onRescheduled }: Props) {
  const { getToken } = useAuth()
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loadingAvail, setLoadingAvail] = useState(false)
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  // Device-clock-independent "now", synced against Postgres' own now() —
  // mirrors the identical fix in the booking page (see lib/serverClock.ts).
  const nowMs = useServerNow()

  useEffect(() => {
    if (!appointment) return
    setSelectedDay(0)
    setSelectedTime('')
    setAvailability(null)
    setConfirming(false)
    setError('')
    setLoadingAvail(true)
    supabase
      .from('doctor_profiles')
      .select('availability')
      .eq('id', appointment.doctorId)
      .maybeSingle()
      .then(({ data }) => {
        setAvailability((data as any)?.availability ?? null)
        setLoadingAvail(false)
      })
  }, [appointment?.doctorId])

  const days = getNextDays(14, availability ?? undefined, nowMs)
  const dayValue = days[selectedDay]?.value ?? ''
  const slots = availability ? getAvailableSlots(availability, dayValue) : []

  useEffect(() => {
    if (!appointment || !dayValue) { setBookedSlots(new Set()); return }
    const dayStart = new Date(`${dayValue}T00:00:00`)
    const dayEnd = new Date(`${dayValue}T23:59:59.999`)

    const fetchBookedSlots = () => {
      supabase
        .from('slot_locks')
        .select('slot_start')
        .eq('doctor_id', appointment.doctorId)
        .gte('slot_start', dayStart.toISOString())
        .lte('slot_start', dayEnd.toISOString())
        .gt('expires_at', new Date().toISOString())
        .then(({ data }) => {
          if (!data) { setBookedSlots(new Set()); return }
          setBookedSlots(new Set(data.map((row: any) => {
            const d = new Date(row.slot_start)
            const h = d.getHours(), m = d.getMinutes()
            const meridiem = h >= 12 ? 'PM' : 'AM'
            const h12 = h % 12 === 0 ? 12 : h % 12
            return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`
          })))
        })
    }

    fetchBookedSlots()

    // Another patient booking/cancelling the same day while this sheet is
    // open must flip that slot's availability live — mirrors the booking
    // page's identical subscription (this modal previously fetched once and
    // never updated until re-opened).
    const channel = supabase
      .channel(`reschedule-slot-locks-${appointment.doctorId}-${dayValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_locks', filter: `doctor_id=eq.${appointment.doctorId}` },
        () => fetchBookedSlots()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [appointment?.doctorId, dayValue])

  async function submitReschedule() {
    if (!appointment || !selectedTime || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated. Please try again.')
      const client = getAuthClient(token)
      const newSlotStart = parseScheduledAt(dayValue, selectedTime)

      const { error: rpcError } = await withTimeout(
        client.rpc('reschedule_appointment_slot', {
          p_consultation_id: appointment.id,
          p_new_slot_start:  newSlotStart,
        }),
        15000,
        'Reschedule request timed out. Please check your connection and try again.',
      )

      if (rpcError) {
        const msg = rpcError.message ?? ''
        if (msg.includes('SLOT_TAKEN')) throw new Error('This time slot was just booked by someone else. Please pick another time.')
        if (msg.includes('SCHEDULED_DISABLED')) throw new Error('This doctor is not accepting scheduled appointments right now.')
        if (msg.includes('DAY_OFF')) throw new Error('This doctor is not available on the selected day.')
        if (msg.includes('DATE_BLOCKED')) throw new Error('This doctor is unavailable on the selected date.')
        if (msg.includes('OUTSIDE_HOURS')) throw new Error("This time is outside the doctor's working hours. Please pick another time.")
        if (msg.includes('INVALID_STATUS')) throw new Error('This appointment can no longer be rescheduled.')
        throw new Error('Failed to reschedule. Please try again.')
      }

      onRescheduled(newSlotStart)
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (!appointment) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-montserrat font-bold text-lg text-ink-black">Reschedule Appointment</h2>
          <button
            onClick={submitting ? undefined : onClose}
            disabled={submitting}
            className="text-ink-black/50 hover:text-ink-black disabled:opacity-40"
          >
            <X size={22} />
          </button>
        </div>
        <p className="text-ink-black/50 text-sm mb-4">
          {appointment.doctorName} &middot; {TYPE_LABEL[appointment.type] ?? appointment.type}
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-danger/10 border border-danger text-danger text-sm px-3 py-2">
            {error}
          </div>
        )}

        {loadingAvail ? (
          <p className="text-ink-black/40 text-sm py-6 text-center">Loading availability…</p>
        ) : confirming ? (
          <div>
            <p className="text-ink-black/70 text-sm mb-6">
              Move this appointment to <span className="font-semibold text-ink-black">{days[selectedDay]?.label} at {selectedTime}</span>?
            </p>
            <div className="flex gap-3">
              <button className="btn-outline flex-1" onClick={() => setConfirming(false)} disabled={submitting}>Back</button>
              <button className="btn-primary flex-1 disabled:opacity-50" onClick={submitReschedule} disabled={submitting}>
                {submitting ? 'Rescheduling…' : 'Confirm New Time'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Date</p>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {days.map((day, idx) => (
                <button
                  key={day.value}
                  onClick={() => { setSelectedDay(idx); setSelectedTime('') }}
                  className={`px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedDay === idx ? 'bg-care-blue text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>

            <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Time</p>
            {slots.length === 0 ? (
              <p className="text-ink-black/40 text-xs py-3">No available slots for this day. Please select another date.</p>
            ) : (
              <>
                <div className="flex items-center gap-4 text-[11px] text-ink-black/60 mb-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-md bg-success/10 border border-success inline-block" /> Available
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-md bg-danger/10 border border-danger inline-block" /> Booked
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mb-6">
                  {slots.map(slot => {
                    const isBooked = bookedSlots.has(slot)
                    const isPast = !isBooked && isSlotPast(dayValue, slot, nowMs)
                    const isDisabled = isBooked || isPast
                    return (
                      <button
                        key={slot}
                        onClick={() => !isDisabled && setSelectedTime(slot)}
                        disabled={isDisabled}
                        className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                          isBooked
                            ? 'bg-danger/10 text-ink-black/40 border border-danger opacity-70 cursor-not-allowed'
                            : isPast
                              ? 'bg-steel-grey/20 text-ink-black/40 border border-steel-grey opacity-60 cursor-not-allowed'
                              : selectedTime === slot ? 'bg-care-blue text-white' : 'bg-success/10 text-ink-black/60 border border-success'
                        }`}
                      >
                        {slot}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button className="btn-outline flex-1" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary flex-1 disabled:opacity-50"
                disabled={!selectedTime}
                onClick={() => setConfirming(true)}
              >
                Continue →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
