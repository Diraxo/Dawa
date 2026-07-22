import { deriveCallState, type DeriveCallStateInput } from '@/hooks/useConsultationState'

// Mirrors the `isCallActive` / `canEndWithSummary` gate copied by hand into
// all four doctor call screens (native video, native phone, web video, web
// phone) — see app/(doctor)/video-consultation.native.tsx,
// app/(doctor)/phone-consultation.native.tsx, and the carehub-web
// equivalents under app/doctor/consultation/{video,phone}/[id]/page.tsx.
// This is release item #1: "Doctor can always end the consultation" — the
// doctor must reach the summary form (not "Cancel Call") in every one of
// these phases.
function isCallActive(phase: ReturnType<typeof deriveCallState>['phase']): boolean {
  return phase === 'on_call' || phase === 'reconnecting' || phase === 'waiting_for_patient'
}

const NOW = Date.parse('2026-07-17T10:05:00.000Z')
const STARTED = '2026-07-17T10:00:00.000Z' // 5 minutes before NOW

const baseDoctor: DeriveCallStateInput = {
  role: 'doctor',
  status: 'in_progress',
  startedAt: STARTED,
  doctorConnectedAt: STARTED,
  patientConnectedAt: STARTED,
  localAgoraReconnecting: false,
  peerReconnecting: false,
  now: NOW,
  hasLoaded: true,
}

describe('deriveCallState — doctor can always end the consultation (release item #1)', () => {
  test('patient never joins: doctor joined, patient never connected -> waiting_for_patient, End Consultation available', () => {
    const out = deriveCallState({
      ...baseDoctor,
      status: 'accepted',
      startedAt: null,
      patientConnectedAt: null,
    })
    expect(out.phase).toBe('waiting_for_patient')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test('patient stuck on "Connecting" (accepted, never reaches in_progress) -> waiting_for_patient, End Consultation available', () => {
    const out = deriveCallState({
      ...baseDoctor,
      status: 'accepted',
      startedAt: null,
      patientConnectedAt: null,
    })
    expect(out.phase).toBe('waiting_for_patient')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test.each([
    'patient closes the app',
    'patient loses internet',
    'patient force-closes the app',
    'patient phone dies',
  ])('%s (after connecting, doctor observes onUserOffline -> local reconnecting) -> reconnecting, End Consultation available', () => {
    // Once a call has genuinely started (both connected_at set, status
    // in_progress), the DB status never reverts just because the patient's
    // peer drops — only this doctor client's own Agora onUserOffline handler
    // flips localAgoraReconnecting, exactly as production code does.
    const out = deriveCallState({ ...baseDoctor, localAgoraReconnecting: true })
    expect(out.phase).toBe('reconnecting')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test('patient stays on "Reconnecting" indefinitely -> still reconnecting after a long time, End Consultation stays available', () => {
    const laterNow = NOW + 20 * 60 * 1000 // 20 minutes later — past the 10-minute stale-cron window
    const out = deriveCallState({ ...baseDoctor, localAgoraReconnecting: true, now: laterNow })
    expect(out.phase).toBe('reconnecting')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test('normal on_call (both connected, no local reconnect signal) -> on_call, End Consultation available', () => {
    const out = deriveCallState(baseDoctor)
    expect(out.phase).toBe('on_call')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test('patient self-reports reconnecting before doctor\'s own Agora onUserOffline fires (peer-reported flag) -> reconnecting immediately', () => {
    // The whole point of migration 093: the doctor's own localAgoraReconnecting
    // signal can lag behind the patient's — the patient's self-reported DB flag
    // must independently drive the doctor into 'reconnecting'.
    const out = deriveCallState({ ...baseDoctor, localAgoraReconnecting: false, peerReconnecting: true })
    expect(out.phase).toBe('reconnecting')
    expect(isCallActive(out.phase)).toBe(true)
  })

  test('a genuinely never-answered outgoing call (accepted, doctor not yet self-connected) -> connecting, Cancel Call is correct here', () => {
    const out = deriveCallState({
      ...baseDoctor,
      status: 'accepted',
      startedAt: null,
      doctorConnectedAt: null,
      patientConnectedAt: null,
    })
    expect(out.phase).toBe('connecting')
    expect(isCallActive(out.phase)).toBe(false)
  })

  test.each(['completed', 'cancelled', 'declined', 'doctor_missed', 'missed', 'call_declined', 'ended_abnormally'])(
    'terminal status %s -> ended (this is the failure mode: if the stale-session cron ever mis-fires mid-call, this is exactly what strands the doctor without a summary form)',
    (status) => {
      const out = deriveCallState({ ...baseDoctor, status })
      expect(out.phase).toBe('ended')
      expect(isCallActive(out.phase)).toBe(false)
    },
  )

  test('not yet loaded (mount/refresh) never renders as ended, even with no status yet', () => {
    const out = deriveCallState({ ...baseDoctor, status: null, hasLoaded: false })
    expect(out.phase).toBe('connecting')
  })
})

describe('deriveCallState — doctor and patient phase agreement (release item #3: connection state)', () => {
  test('both roles derive the same phase from the same row for the core lifecycle phases', () => {
    const rows: Array<Omit<DeriveCallStateInput, 'role'>> = [
      { status: 'in_progress', startedAt: STARTED, doctorConnectedAt: STARTED, patientConnectedAt: STARTED, localAgoraReconnecting: false, peerReconnecting: false, now: NOW, hasLoaded: true },
      { status: 'in_progress', startedAt: STARTED, doctorConnectedAt: STARTED, patientConnectedAt: STARTED, localAgoraReconnecting: true, peerReconnecting: false, now: NOW, hasLoaded: true },
      { status: 'in_progress', startedAt: STARTED, doctorConnectedAt: STARTED, patientConnectedAt: STARTED, localAgoraReconnecting: false, peerReconnecting: true, now: NOW, hasLoaded: true },
      { status: 'completed', startedAt: STARTED, doctorConnectedAt: STARTED, patientConnectedAt: STARTED, localAgoraReconnecting: false, peerReconnecting: false, now: NOW, hasLoaded: true },
    ]
    for (const row of rows) {
      const doctorPhase = deriveCallState({ ...row, role: 'doctor' }).phase
      const patientPhase = deriveCallState({ ...row, role: 'patient' }).phase
      expect(doctorPhase).toBe(patientPhase)
    }
  })

  test('elapsedSeconds is a pure function of (now, startedAt) — same for both roles, never drifts by construction', () => {
    const doctorOut = deriveCallState({ ...baseDoctor, role: 'doctor' })
    const patientOut = deriveCallState({ ...baseDoctor, role: 'patient' })
    expect(doctorOut.elapsedSeconds).toBe(300) // 5 minutes
    expect(doctorOut.elapsedSeconds).toBe(patientOut.elapsedSeconds)
  })
})
