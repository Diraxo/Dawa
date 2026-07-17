// Test-only stand-in for lib/supabase.ts. The consultation-state unit tests
// only exercise the pure `deriveCallState` export; the real module pulls in
// AsyncStorage/Clerk wiring that has no place in a Node test environment.
export const supabase = {
  from() {
    return {
      select() { return this },
      eq() { return this },
      in() { return this },
      single() { return Promise.resolve({ data: null, error: null }) },
      update() { return this },
      then(resolve: (v: { data: null; error: null }) => void) { resolve({ data: null, error: null }) },
    }
  },
  channel() {
    return { on() { return this }, subscribe() { return this } }
  },
  removeChannel() {},
}
