// Single shared call-duration formatter — every screen that shows how long a
// consultation has been running (video/phone call screens, CallInfoPanel,
// ActiveCallBanner) must use this instead of its own ad-hoc `formatTime`, so
// a 70+ minute call can never render as "70:00" on one screen and "1:10:00"
// on another. Matches standard phone-call duration formatting: MM:SS under
// an hour, H:MM:SS once it crosses one hour.
export function formatCallDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
