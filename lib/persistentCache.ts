import AsyncStorage from '@react-native-async-storage/async-storage'

// Generic last-known-good cache for small JSON-serializable screen state
// (dashboard stats, today's schedule, profile summaries, doctor lists) —
// same two-tier shape as hooks/useOwnProfilePhoto.ts's bespoke cache, just
// reusable across screens instead of hand-rolled per hook. Memory-first so
// switching tabs within a session paints instantly with zero await; disk
// (AsyncStorage) as the fallback so a cold start also has something to show
// immediately instead of a blank/zeroed screen while the network round-trip
// (Clerk token + Supabase query) is still in flight.
const _memory = new Map<string, unknown>()

/** Synchronous, memory-only read — use for the `useState(() => ...)` initializer. */
export function getCachedJsonSync<T>(key: string): T | undefined {
  return _memory.has(key) ? (_memory.get(key) as T) : undefined
}

/** Memory first, then AsyncStorage — resolves to undefined if neither has a value yet. */
export async function getCachedJson<T>(key: string): Promise<T | undefined> {
  if (_memory.has(key)) return _memory.get(key) as T
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw == null) return undefined
    const value = JSON.parse(raw) as T
    _memory.set(key, value)
    return value
  } catch {
    return undefined
  }
}

export function setCachedJson<T>(key: string, value: T): void {
  _memory.set(key, value)
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {})
}
