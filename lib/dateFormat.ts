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

// "Just now" / "5m ago" / "3h ago" / "2d ago" / falls back to a short date
// past a week — used by the Notification Center list.
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
