// Shared slot-generation/validation helpers for booking + rescheduling.
// Single source of truth so the booking page and RescheduleModal can't
// silently drift from each other the way this codebase's mobile/web pair
// has before.

// Loosely typed on purpose — this mirrors a jsonb column with day-keyed
// slot config plus a few sibling fields (blocked_dates, toggles), which
// doesn't fit a clean index-signature type without fighting the compiler.
export type Availability = Record<string, any>

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Must match book_appointment_slot's p_slot_duration default (20 min) — a
// slot is only offered if the full consultation fits before the doctor's
// configured end time, not just the slot's start time.
export const SLOT_DURATION_MINS = 20

export function parseTimeMins(t: string): number {
  const [timePart, meridiem] = t.split(' ')
  const [h, m] = timePart.split(':').map(Number)
  let hour = h
  if (meridiem === 'PM' && h !== 12) hour += 12
  if (meridiem === 'AM' && h === 12) hour = 0
  return hour * 60 + m
}

export function formatTimeMins(totalMins: number): string {
  const h24 = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const meridiem = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`
}

// Local (device) calendar date, not UTC — `toISOString()` would return the
// previous day's date during the first few hours after local midnight for
// any UTC+ timezone (this app's user base is Africa/Addis_Ababa, UTC+3),
// which would offer/label the wrong day as "Today" during that window.
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// A slot on today's date is past once its full duration (start -> start +
// duration) has already elapsed — matches the "full slot must fit" rule
// used everywhere else (getAvailableSlots, book_appointment_slot).
export function isSlotPast(dayValue: string, slot: string): boolean {
  const now = new Date()
  if (dayValue !== localDateString(now)) return false
  const nowMins = now.getHours() * 60 + now.getMinutes()
  return parseTimeMins(slot) + SLOT_DURATION_MINS <= nowMins
}

export function getAvailableSlots(availability: Availability | null | undefined, dayValue: string): string[] {
  if (!availability) return []
  const dayName = DAY_NAMES[new Date(dayValue + 'T12:00:00').getDay()]
  const cfg = availability[dayName]
  if (!cfg?.enabled || !cfg.startTime || !cfg.endTime) return []
  const blocked: string[] = availability.blocked_dates ?? []
  if (blocked.includes(dayValue)) return []
  const start = parseTimeMins(cfg.startTime)
  const end = parseTimeMins(cfg.endTime)
  const slots: string[] = []
  for (let t = start; t + SLOT_DURATION_MINS <= end; t += SLOT_DURATION_MINS) slots.push(formatTimeMins(t))
  return slots
}

export function getNextDays(count: number, availability?: Availability | null) {
  const days = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const value = localDateString(d)
    if (availability) {
      const slots = getAvailableSlots(availability, value)
      if (slots.length === 0) continue
    }
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      value,
    })
  }
  return days
}

// Must produce a UTC ISO string, not a bare local-looking timestamp — the
// backend column is timestamptz, and a string with no offset gets interpreted
// in the DB session's timezone (UTC), silently shifting the booking by the
// device's UTC offset relative to what the patient picked and saw on screen.
export function parseScheduledAt(dayValue: string, timeSlot: string): string {
  const [timePart, meridiem] = timeSlot.split(' ')
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)
  if (meridiem === 'PM' && hour !== 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  return new Date(`${dayValue}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).toISOString()
}
