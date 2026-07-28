// Shared slot-generation/validation helpers for booking + rescheduling.
// Single source of truth so BookingModal and RescheduleModal can't silently
// drift from each other the way this codebase's mobile/web pair has before.

// Loosely typed on purpose — this mirrors a jsonb column with day-keyed
// slot config plus a few sibling fields (blocked_dates, toggles), which
// doesn't fit a clean index-signature type without fighting the compiler.
export type Availability = Record<string, any>

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

const ETHIOPIA_TZ = 'Africa/Addis_Ababa'

// Wall-clock date/time as observed in Africa/Addis_Ababa right now, derived
// via Intl rather than the device's own getHours()/getDate() — those reflect
// whatever timezone the device happens to be configured for, which may not
// be Ethiopia's even for a patient physically in Ethiopia (misconfigured
// device, traveler, etc). The spec requires Ethiopia local time as the
// single source of truth, evaluated down to the second, independent of the
// device.
//
// `nowMs` defaults to Date.now() (the device clock) but every call site that
// can supply a server-synced instant (see lib/serverClock.ts's
// useServerNow()) should pass one — the device clock's absolute value is not
// trustworthy on its own (unset, misconfigured, or turned back deliberately
// to keep an already-past slot looking bookable). This function only ever
// reinterprets whatever instant it's given into Ethiopia wall-clock fields;
// it never re-reads the device clock behind the caller's back.
function nowInEthiopia(nowMs: number = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ETHIOPIA_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  // hour12: false yields "24" at Ethiopia-midnight in some ICU builds.
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

function ethiopiaDateString(nowMs?: number): string {
  const { year, month, day } = nowInEthiopia(nowMs)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// The UTC instant boundaries of "today" as observed in Africa/Addis_Ababa —
// for filtering `scheduled_at`/`ended_at` timestamptz columns by calendar
// day. Doctor screens previously computed "today" via `new Date();
// today.setHours(0,0,0,0)`, i.e. the DEVICE's local midnight — consistent
// with each other, but not with the Ethiopia wall-clock date this file's
// booking/slot logic is anchored to everywhere else, so a doctor whose
// device isn't set to Africa/Addis_Ababa could see a boundary that disagrees
// with the actual Ethiopia booking day. Africa/Addis_Ababa is UTC+3 with no
// DST, so Ethiopia midnight is always UTC 21:00 the previous day —
// Date.UTC's hour argument normalizes -3 into that rollback automatically.
export function ethiopiaTodayRange(): { startIso: string; endIso: string } {
  const { year, month, day } = nowInEthiopia()
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0))
  const end = new Date(Date.UTC(year, month - 1, day + 1, -3, 0, 0))
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// Adds `days` to a YYYY-MM-DD calendar date via UTC arithmetic (never a
// device-local Date), so day rollover can't be nudged by the device's own
// timezone either.
function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function formatWeekdayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Noon UTC keeps the calendar date stable regardless of device timezone
  // when formatting for display below.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// A slot is past the instant its own start time is reached — not once its
// full duration has elapsed. (It previously used `+ SLOT_DURATION_MINS`,
// which kept a 14:20 slot showing as bookable until 14:40 — the exact stale
// -slot bug reported: "current time 14:25, scheduler still showed 14:20.")
// This matches the server-side guard in book_appointment_slot() /
// reschedule_appointment_slot() (`slot_start < now() - 2min` grace), and is
// evaluated against Ethiopia wall-clock time down to the second.
//
// `nowMs` should be a server-synced instant (lib/serverClock.ts's
// useServerNow()) whenever the caller has one — see nowInEthiopia() above.
export function isSlotPast(dayValue: string, slot: string, nowMs?: number): boolean {
  const today = ethiopiaDateString(nowMs)
  if (dayValue < today) return true
  if (dayValue > today) return false
  const { hour, minute, second } = nowInEthiopia(nowMs)
  const nowSecs = hour * 3600 + minute * 60 + second
  return parseTimeMins(slot) * 60 <= nowSecs
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

export function getNextDays(count: number, availability?: Availability | null, nowMs?: number) {
  const days = []
  const today = ethiopiaDateString(nowMs)
  for (let i = 0; i < count; i++) {
    const value = i === 0 ? today : addDaysToDateString(today, i)
    // Every day in the range is shown, even ones the doctor has no slots
    // for — today and tomorrow must never be skipped just because the
    // doctor isn't working that day. getAvailableSlots() returning [] for a
    // selected day drives the "not available on this day" empty state
    // instead of hiding the day entirely.
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatWeekdayLabel(value),
      value,
    })
  }
  return days
}

// Ethiopia is a fixed UTC+3 offset year-round (no DST) — construct the
// instant directly in UTC rather than trusting `new Date("...T...")` to
// interpret a bare local-looking timestamp, which silently shifts the
// booking by the device's own UTC offset relative to Ethiopia's whenever the
// device isn't itself set to Africa/Addis_Ababa (spec: Ethiopia local time
// is the single source of truth, not the device's).
export function parseScheduledAt(dayValue: string, timeSlot: string): string {
  const [timePart, meridiem] = timeSlot.split(' ')
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)
  if (meridiem === 'PM' && hour !== 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  const [y, m, d] = dayValue.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour - 3, min, 0)).toISOString()
}
