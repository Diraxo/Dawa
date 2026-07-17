import fs from 'fs'
import path from 'path'

// Release item #5 (ghost consultation) and item #1's "must never show an
// incoming call / auto-decline countdown after acceptance" requirement.
// app/_layout.tsx owns notification-tap routing for the whole app; it has
// far too many native-module side effects (stream-chat-expo, VoIP push,
// Clerk token cache) to safely import into a Jest/Node run, so this is a
// textual guard on the specific invariants that fixed the ghost-call bug —
// see project memory "Ghost consultation" root cause: a doctor tapping a
// stale notification must re-check live status rather than trusting the
// push payload snapshot, and a patient tapping a stale "waiting" tap must
// skip the ringing UI entirely when the consultation is already
// accepted/in_progress.

const LAYOUT = fs.readFileSync(path.resolve(__dirname, '..', 'app/_layout.tsx'), 'utf8')

describe('ghost consultation guards in app/_layout.tsx', () => {
  test('GHOST_TERMINAL_STATUSES matches the terminal-status set the call-state machine uses', () => {
    const match = LAYOUT.match(/GHOST_TERMINAL_STATUSES = new Set\(\[([\s\S]*?)\]\)/)
    expect(match).not.toBeNull()
    const statuses = match![1]
      .split(',')
      .map(s => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)

    // Same 7 statuses exercised against deriveCallState in
    // __tests__/deriveCallState.test.ts — if a new terminal status is added
    // to one and not the other, a stale "active consultation" banner or a
    // ghost incoming-call screen can survive past the actual end of the call.
    expect(new Set(statuses)).toEqual(
      new Set(['completed', 'cancelled', 'declined', 'doctor_missed', 'missed', 'call_declined', 'ended_abnormally']),
    )
  })

  test('resolveIncomingRequestRoute re-fetches live status before routing a tapped notification', () => {
    const fnMatch = LAYOUT.match(/async function resolveIncomingRequestRoute[\s\S]*?\n}\n/)
    expect(fnMatch).not.toBeNull()
    const fn = fnMatch![0]
    // Must query the live row rather than trusting the notification payload.
    expect(fn).toMatch(/\.from\('consultations'\)/)
    expect(fn).toMatch(/\.select\('status'\)/)
    // Must only route into the incoming-request (ringing) screen while the
    // live status is still actually waiting_for_doctor.
    expect(fn).toMatch(/liveStatus === 'waiting_for_doctor'/)
  })

  test('a tapped "waiting"/"waiting-room" notification skips the ringing UI when already accepted/in_progress (fromCallkeep bypass)', () => {
    // The self-heal path around the waiting/waiting-room notification tap
    // case must pass fromCallkeep so the receiving call screen skips its own
    // ringing/auto-decline countdown for an already-connected or
    // since-ended consultation.
    const occurrences = LAYOUT.match(/fromCallkeep:\s*'1'/g) ?? []
    expect(occurrences.length).toBeGreaterThan(0)
  })

  test('a live Realtime subscription clears the persisted active-consultation store on any terminal status while foregrounded', () => {
    expect(LAYOUT).toMatch(/GHOST_TERMINAL_STATUSES\.has\(status\)/)
  })
})
