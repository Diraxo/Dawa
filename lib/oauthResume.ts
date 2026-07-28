// Distinguishes "app cold-started because Android killed the process while
// Chrome was handling Google/Apple OAuth and is now relaunching us via the
// dawa:// redirect deep link" from a genuine fresh app open. Android has no
// API to tell a debug-client process (which a debugger/Metro connection
// exempts from the low-memory killer) from a release process (which isn't)
// apart from process survival itself — the OS will show its own launch
// theme on this relaunch regardless. What we *can* control is not stacking
// our own heavy, animated, minimum-2500ms branded splash on top of that —
// see app/index.tsx and app/(auth)/splash.tsx's `instant` handling.
import AsyncStorage from '@react-native-async-storage/async-storage'

const OAUTH_IN_FLIGHT_KEY = 'dawa_oauth_in_flight_at'
// If the marker is older than this, treat it as an abandoned/crashed flow
// rather than a genuine resume — a real Google/Apple auth round-trip never
// takes this long, and a stale marker must never make a real fresh app open
// years later render the lightweight loading state instead of the splash.
const MAX_AGE_MS = 5 * 60 * 1000

export async function markOAuthInFlight(): Promise<void> {
  try {
    await AsyncStorage.setItem(OAUTH_IN_FLIGHT_KEY, String(Date.now()))
  } catch {}
}

export async function clearOAuthInFlight(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OAUTH_IN_FLIGHT_KEY)
  } catch {}
}

// Reads and clears the marker in one call — it must only ever apply to the
// single cold start it was meant for, never a later one too.
export async function consumeOAuthInFlight(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(OAUTH_IN_FLIGHT_KEY)
    if (!raw) return false
    await AsyncStorage.removeItem(OAUTH_IN_FLIGHT_KEY)
    return Date.now() - Number(raw) < MAX_AGE_MS
  } catch {
    return false
  }
}
