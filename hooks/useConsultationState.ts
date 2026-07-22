import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type Role = 'doctor' | 'patient'

export type CallPhase =
  | 'waiting_for_doctor'
  | 'waiting_for_patient'
  | 'connecting'
  | 'on_call'
  | 'reconnecting'
  | 'ended'

const TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled',
  'declined',
  'doctor_missed',
  'missed',
  'call_declined',
  'ended_abnormally',
])

interface ConsultationRow {
  status: string
  started_at: string | null
  doctor_connected_at: string | null
  patient_connected_at: string | null
  patient_left_at: string | null
  doctor_reconnecting: boolean
  patient_reconnecting: boolean
}

export interface DeriveCallStateInput {
  role: Role
  status: string | null
  startedAt: string | null
  doctorConnectedAt: string | null
  patientConnectedAt: string | null
  localAgoraReconnecting: boolean
  peerReconnecting: boolean
  now: number
  hasLoaded: boolean
}

export interface DeriveCallStateOutput {
  phase: CallPhase
  callStartedAtMs: number | null
  elapsedSeconds: number | null
}

// Single source of truth for translating a `consultations` row (plus this
// client's own local Agora reconnect signal) into a UI phase. Mirrors
// carehub-web/hooks/useConsultationState.ts's deriveCallState verbatim — both
// apps must agree on this transition table since they render the same DB row
// from opposite roles. Both the doctor and patient screens call this exact
// function with role-appropriate inputs, so the two sides are structurally
// unable to disagree about what a given row means.
export function deriveCallState(input: DeriveCallStateInput): DeriveCallStateOutput {
  const { role, status, startedAt, doctorConnectedAt, patientConnectedAt, localAgoraReconnecting, peerReconnecting, now, hasLoaded } = input

  // Before the first DB row has actually arrived (mount, refresh, resume,
  // reconnect), `status` is null purely because we don't know it yet — that
  // is NOT the same as a terminal status, and must never render as 'ended'.
  if (!hasLoaded) {
    return { phase: 'connecting', callStartedAtMs: null, elapsedSeconds: null }
  }

  if (!status || TERMINAL_STATUSES.has(status)) {
    return { phase: 'ended', callStartedAtMs: null, elapsedSeconds: null }
  }

  if (status === 'in_progress') {
    const callStartedAtMs = startedAt ? new Date(startedAt).getTime() : null
    const elapsedSeconds = callStartedAtMs != null ? Math.max(0, Math.floor((now - callStartedAtMs) / 1000)) : null
    // Either side's own reconnect signal — mine locally (instant), or the
    // peer's self-reported flag mirrored over Realtime — puts both screens
    // into 'reconnecting' together instead of only the device that noticed
    // first (see migration 093).
    const reconnecting = localAgoraReconnecting || peerReconnecting
    return { phase: reconnecting ? 'reconnecting' : 'on_call', callStartedAtMs, elapsedSeconds }
  }

  if (status === 'accepted') {
    const selfConnected = role === 'doctor' ? !!doctorConnectedAt : !!patientConnectedAt
    const peerConnected = role === 'doctor' ? !!patientConnectedAt : !!doctorConnectedAt
    if (selfConnected && !peerConnected) {
      return { phase: role === 'doctor' ? 'waiting_for_patient' : 'waiting_for_doctor', callStartedAtMs: null, elapsedSeconds: null }
    }
    return { phase: 'connecting', callStartedAtMs: null, elapsedSeconds: null }
  }

  // Pre-acceptance statuses (waiting_for_doctor, pending_payment, ...) are
  // handled by page-specific ringing/waiting-room UI, not this hook.
  return { phase: 'connecting', callStartedAtMs: null, elapsedSeconds: null }
}

interface UseConsultationStateArgs {
  consultationId: string | undefined
  role: Role
  localAgoraReconnecting: boolean
}

export function useConsultationState({ consultationId, role, localAgoraReconnecting }: UseConsultationStateArgs) {
  const [row, setRow] = useState<ConsultationRow | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const selfConnectedWrittenRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Mount fetch — authoritative DB state on first load or app resume, so
  // reopening the app mid-call shows the correct phase/timer immediately
  // instead of waiting for a fresh Agora event or a later Realtime update.
  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    supabase
      .from('consultations')
      .select('status, started_at, doctor_connected_at, patient_connected_at, patient_left_at, doctor_reconnecting, patient_reconnecting')
      .eq('id', consultationId)
      .single()
      .then(
        ({ data }) => {
          if (cancelled) return
          if (data) setRow(data as unknown as ConsultationRow)
          setHasLoaded(true)
        },
        () => { if (!cancelled) setHasLoaded(true) },
      )
    return () => { cancelled = true }
  }, [consultationId])

  // Realtime — the one subscription both roles rely on for this row; the DB
  // trigger (see supabase/migrations/035_consultation_connected_at.sql) is
  // the only writer of status/started_at for the connect transition, so this
  // event is identical for both parties.
  useEffect(() => {
    if (!consultationId) return
    const ch = supabase
      .channel(`consultation-state-${role}-${consultationId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` },
        (payload) => { setRow(payload.new as unknown as ConsultationRow); setHasLoaded(true) },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [consultationId, role])

  // Poll fallback in case a Realtime event is dropped, mirroring the existing
  // waiting-room poll-fallback pattern used elsewhere in this app. Keeps
  // running for the whole call (not just pre-connect) — if this client's
  // Realtime socket drops mid-call and the peer's status write (e.g. ended,
  // ended_abnormally) lands entirely inside that outage window, there is no
  // other mechanism that would ever catch it up.
  useEffect(() => {
    if (!consultationId) return
    if (row && TERMINAL_STATUSES.has(row.status)) return
    const t = setInterval(() => {
      supabase
        .from('consultations')
        .select('status, started_at, doctor_connected_at, patient_connected_at, patient_left_at, doctor_reconnecting, patient_reconnecting')
        .eq('id', consultationId)
        .single()
        .then(
          ({ data }) => { if (data) { setRow(data as unknown as ConsultationRow); setHasLoaded(true) } },
          () => {},
        )
    }, 3000)
    return () => clearInterval(t)
  }, [consultationId, row?.status])

  const peerReconnecting = role === 'doctor' ? !!row?.patient_reconnecting : !!row?.doctor_reconnecting

  const derived = deriveCallState({
    role,
    status: row?.status ?? null,
    startedAt: row?.started_at ?? null,
    doctorConnectedAt: row?.doctor_connected_at ?? null,
    patientConnectedAt: row?.patient_connected_at ?? null,
    localAgoraReconnecting,
    peerReconnecting,
    now,
    hasLoaded,
  })

  // Called once this client's own Agora publish succeeds. Never waits on or
  // reacts to the peer's media — each side reports only its own milestone,
  // and the DB trigger performs the "both connected" transition atomically.
  const markSelfConnected = useCallback(() => {
    if (selfConnectedWrittenRef.current || !consultationId) return
    selfConnectedWrittenRef.current = true
    const nowIso = new Date().toISOString()
    const payload = role === 'doctor' ? { doctor_connected_at: nowIso } : { patient_connected_at: nowIso }
    supabase
      .from('consultations')
      .update(payload)
      .eq('id', consultationId)
      .eq('status', 'accepted')
      .then(() => {}, () => {})
  }, [consultationId, role])

  // Mirrors this device's own local Agora reconnect signal onto the row so
  // the peer's screen picks it up over Realtime instead of waiting on
  // Agora's own (slower) cross-peer onUserOffline detection — see migration
  // 093. Skips redundant writes when the value hasn't actually changed.
  const lastReconnectingWrittenRef = useRef(false)
  useEffect(() => {
    if (!consultationId) return
    if (lastReconnectingWrittenRef.current === localAgoraReconnecting) return
    lastReconnectingWrittenRef.current = localAgoraReconnecting
    const payload = role === 'doctor'
      ? { doctor_reconnecting: localAgoraReconnecting }
      : { patient_reconnecting: localAgoraReconnecting }
    supabase
      .from('consultations')
      .update(payload)
      .eq('id', consultationId)
      .then(() => {}, () => {})
  }, [consultationId, role, localAgoraReconnecting])

  // Patient-only: called on every successful join/rejoin (initial connect
  // *and* any later reconnect after "Leave Call"), unlike markSelfConnected
  // which is a one-shot gated to the 'accepted' transition. Clears a stale
  // patient_left_at so the doctor's "Patient has left" banner drops the
  // instant the patient is actually back.
  const clearPatientLeft = useCallback(() => {
    if (role !== 'patient' || !consultationId) return
    supabase
      .from('consultations')
      .update({ patient_left_at: null })
      .eq('id', consultationId)
      .then(() => {}, () => {})
  }, [consultationId, role])

  return {
    phase: derived.phase,
    elapsedSeconds: derived.elapsedSeconds,
    callStartedAtMs: derived.callStartedAtMs,
    startedAtIso: row?.started_at ?? null,
    isPeerConnected: role === 'doctor' ? !!row?.patient_connected_at : !!row?.doctor_connected_at,
    markSelfConnected,
    clearPatientLeft,
    patientHasLeft: !!row?.patient_left_at,
    rawStatus: row?.status ?? null,
  }
}
