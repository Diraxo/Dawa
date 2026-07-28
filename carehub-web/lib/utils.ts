import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'ETB') {
  return `${currency} ${amount.toLocaleString()}`
}

export function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDateTime(dateString: string) {
  return `${formatDate(dateString)} at ${formatTime(dateString)}`
}

// "Today at 10:40 AM" / "Tomorrow at 10:40 AM" / "Monday, July 13 at 10:40 AM"
// — the friendly form used for scheduled-appointment confirmations, in the
// viewer's local timezone. Distinct from formatDateTime, which always shows
// a bare weekday/month/day regardless of how close the date is.
export function formatFriendlyDateTime(dateString: string) {
  const d = new Date(dateString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const time = formatTime(dateString)
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `${dateLabel} at ${time}`
}

export function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

// Strips existing "Dr." prefix so the UI can safely add its own without doubling
export function stripDrPrefix(name: string): string {
  return name.replace(/^Dr\.?\s+/i, '').trim()
}

// Doctor "languages spoken" values are sometimes seeded directly into the
// DB with inconsistent casing, so patient-facing displays capitalize
// defensively rather than trusting the stored casing.
// Mirrors mobile's capitalizeLanguage() (lib/languageFormat.ts).
export function capitalizeLanguage(lang: string): string {
  const trimmed = lang.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}

export interface ParsedPrescription {
  medicine: string
  dosage?: string
  duration?: string
  instructions?: string
}

// consultation_summaries.prescription is stored as a JSON-stringified array of
// structured entries by every writer; a few legacy rows may be plain text.
// Always fall back to the raw string so nothing renders blank.
export function parsePrescription(raw: string | null): ParsedPrescription[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
