// "Today at 10:40 AM" / "Tomorrow at 10:40 AM" / "Monday, July 13 at 10:40 AM"
// — the friendly form used for scheduled-appointment confirmations, in the
// device's local timezone. Single source of truth so payment-return.tsx and
// the appointments list can't drift from each other the way they used to
// (payment-return had its own non-Today/Tomorrow-aware formatter despite a
// comment claiming it mirrored the appointments tab).
export function formatFriendlyDateTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `${dateLabel} at ${time}`
}
