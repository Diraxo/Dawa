import fs from 'fs'
import path from 'path'

// Release item #1 (doctor can always end the consultation) has a second,
// less obvious failure mode beyond the UI gate: `useHeartbeat` feeds
// consultations.last_heartbeat_at, and supabase/migrations/023_doctor_missed_and_heartbeat.sql's
// mark_stale_active_consultations() cron force-ends (status='ended_abnormally')
// any 'accepted'/'in_progress'/'active' row whose heartbeat has gone quiet for
// 10 minutes. If the doctor screen only sends a heartbeat while callStatus is
// literally 'connected', then any patient network blip/backgrounding/dead
// phone lasting past 10 minutes silently ends the whole consultation out from
// under the doctor — reproducing exactly the "patient loses internet" /
// "patient stays on Reconnecting" / "patient force-closes the app" / "patient
// phone dies" scenarios from the release spec, with no summary form ever
// shown. This was a real, previously-unfixed bug in both native doctor call
// screens (the web doctor screens already had the fix). This file guards all
// four hand-duplicated copies of the gate so it cannot silently regress in
// any one of them.
//
// It reads the source as text rather than importing the screens directly —
// these files pull in React Native / Next.js / Agora SDK modules that have no
// place in a plain Node test environment, and the codebase's own convention
// (see comments in hooks/useConsultationState.ts) is that this exact
// state-machine logic is intentionally hand-mirrored per platform rather than
// shared, so a textual consistency check is the correct level for this guard.

const ROOT = path.resolve(__dirname, '..')

const CALL_SCREENS = [
  'app/(doctor)/video-consultation.native.tsx',
  'app/(doctor)/phone-consultation.native.tsx',
  'carehub-web/app/doctor/consultation/video/[id]/page.tsx',
  'carehub-web/app/doctor/consultation/phone/[id]/page.tsx',
]

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

describe('doctor heartbeat stays alive through a patient reconnect (regression guard)', () => {
  test.each(CALL_SCREENS)('%s: useHeartbeat is active for both "connected" and "reconnecting"', (relPath) => {
    const src = readSource(relPath)
    const heartbeatCallMatch = src.match(/useHeartbeat\([^)]*\)/)
    expect(heartbeatCallMatch).not.toBeNull()
    const heartbeatCall = heartbeatCallMatch![0]
    expect(heartbeatCall).toMatch(/=== 'connected'/)
    expect(heartbeatCall).toMatch(/=== 'reconnecting'/)
  })

  test.each(CALL_SCREENS)('%s: End Consultation gate treats on_call/reconnecting/waiting_for_patient as active', (relPath) => {
    const src = readSource(relPath)
    // Native screens compute an inline `isCallActive`; web screens compute
    // `canEndWithSummary`. Either way, the same three phases must unlock the
    // summary form instead of routing into the "Cancel Call" abandon flow.
    const gateMatch = src.match(/const (?:isCallActive|canEndWithSummary) = [\s\S]*?(?=\n\n|\n  \/\/|\n  const|\nasync)/)
    expect(gateMatch).not.toBeNull()
    const gate = gateMatch![0]
    expect(gate).toMatch(/on_call|'connected'/)
    expect(gate).toMatch(/reconnecting/)
    expect(gate).toMatch(/waiting_for_patient|'waiting'/)
  })
})
