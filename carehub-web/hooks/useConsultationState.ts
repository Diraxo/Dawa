'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@clerk/nextjs'
import { supabase, getAuthClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

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
}

export interface DeriveCallStateInput {
  role: Role
  status: string | null
  startedAt: string | null
  doctorConnectedAt: string | null
  patientConnectedAt: string | null
  localAgoraReconnecting: boolean
  now: number
  hasLoaded: boolean
}

export interface DeriveCallStateOutput {
  phase: CallPhase
  callStartedAtMs: number | null
  elapsedSeconds: number | null
}

// Single source of truth for translating a `consultations` row (plus this
// client's own local Agora reconnect signal) into a UI phase. Both the doctor
// and patient pages call this exact function with role-appropriate inputs, so
// the two sides are structurally unable to disagree about what a given row
// means — there is no client-local inference of "the other party is
// connected" left anywhere.
export function deriveCallState(input: DeriveCallStateInput): DeriveCallStateOutput {
  const { role, status, startedAt, doctorConnectedAt, patientConnectedAt, localAgoraReconnecting, now, hasLoaded } = input

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
    return { phase: localAgoraReconnecting ? 'reconnecting' : 'on_call', callStartedAtMs, elapsedSeconds }
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
  consultationId: string
  role: Role
  localAgoraReconnecting: boolean
}

export function useConsultationState({ consultationId, role, localAgoraReconnecting }: UseConsultationStateArgs) {
  const { getToken } = useAuth()
  const [row, setRow] = useState<ConsultationRow | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const selfConnectedWrittenRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Mount fetch — authoritative DB state on first load or refresh, so a
  // reload mid-call shows the correct phase/timer immediately instead of
  // waiting for a fresh Agora event or a later Realtime update.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('consultations')
        .select('status, started_at, doctor_connected_at, patient_connected_at')
        .eq('id', consultationId)
        .single()
      if (cancelled) return
      if (error) {
        logger.error(`[ConsultationState][${role}][${Date.now()}] mount fetch failed:`, error)
      } else if (data) {
        const r = data as ConsultationRow
        logger.log(`[ConsultationState][${role}][${Date.now()}] mount fetch — status:${r.status} doctorConnected:${!!r.doctor_connected_at} patientConnected:${!!r.patient_connected_at}`)
        setRow(r)
      }
      setHasLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [consultationId, role])

  // Realtime — the one subscription both roles rely on for this row; the DB
  // trigger (see migration 035) is the only writer of status/started_at for
  // the connect transition, so this event is identical for both parties.
  useEffect(() => {
    const ch = supabase
      .channel(`consultation-state-${role}-${consultationId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` }, (payload) => {
        const r = payload.new as ConsultationRow
        logger.log(`[ConsultationState][${role}][${Date.now()}] realtime UPDATE — status:${r.status} doctorConnected:${!!r.doctor_connected_at} patientConnected:${!!r.patient_connected_at}`)
        setRow(r)
        setHasLoaded(true)
      })
      .subscribe((status, err) => {
        logger.log(`[ConsultationState][${role}][${Date.now()}] realtime subscribe status:${status}${err ? ` error:${err}` : ''}`)
      })
    return () => { supabase.removeChannel(ch) }
  }, [consultationId, role])

  // Poll fallback in case a Realtime event is dropped, mirroring the existing
  // waiting-room poll-fallback pattern used elsewhere in this app. Keeps
  // running for the whole call (not just pre-connect) — if this client's
  // Realtime socket drops mid-call and the peer's status write (e.g. ended,
  // ended_abnormally) lands entirely inside that outage window, there is no
  // other mechanism that would ever catch it up.
  useEffect(() => {
    if (row && TERMINAL_STATUSES.has(row.status)) return
    const t = setInterval(async () => {
      const { data, error } = await supabase
        .from('consultations')
        .select('status, started_at, doctor_connected_at, patient_connected_at')
        .eq('id', consultationId)
        .single()
      if (error) {
        logger.error(`[ConsultationState][${role}][${Date.now()}] poll fallback fetch failed:`, error)
        return
      }
      if (data) {
        const r = data as ConsultationRow
        // Only log when the poll actually disagrees with what we already have —
        // this fires every 3s for the whole call, so logging every tick would
        // drown out everything else.
        if (!row || row.status !== r.status || !!row.doctor_connected_at !== !!r.doctor_connected_at || !!row.patient_connected_at !== !!r.patient_connected_at) {
          logger.log(`[ConsultationState][${role}][${Date.now()}] poll fallback caught a change — status:${r.status} doctorConnected:${!!r.doctor_connected_at} patientConnected:${!!r.patient_connected_at}`)
        }
        setRow(r)
        setHasLoaded(true)
      }
    }, 3000)
    return () => clearInterval(t)
  }, [consultationId, row?.status])

  const derived = deriveCallState({
    role,
    status: row?.status ?? null,
    startedAt: row?.started_at ?? null,
    doctorConnectedAt: row?.doctor_connected_at ?? null,
    patientConnectedAt: row?.patient_connected_at ?? null,
    localAgoraReconnecting,
    now,
    hasLoaded,
  })

  // Called once this client's own Agora publish succeeds. Never waits on or
  // reacts to the peer's media — each side reports only its own milestone,
  // and the DB trigger performs the "both connected" transition atomically.
  const markSelfConnected = useCallback(async () => {
    if (selfConnectedWrittenRef.current) return
    selfConnectedWrittenRef.current = true
    try {
      const tok = await getToken()
      if (!tok) {
        logger.error(`[ConsultationState][${role}][${Date.now()}] markSelfConnected — no Clerk token, write skipped`)
        selfConnectedWrittenRef.current = false
        return
      }
      const nowIso = new Date().toISOString()
      const payload = role === 'doctor' ? { doctor_connected_at: nowIso } : { patient_connected_at: nowIso }
      // .select() so we can see how many rows actually matched — a silent
      // 0-row update (status wasn't 'accepted' at write time, e.g. a stale
      // client raced a status change) is exactly what leaves this client
      // stuck on 'waiting for the other party' forever with no other signal.
      const { data, error } = await getAuthClient(tok)
        .from('consultations')
        .update(payload)
        .eq('id', consultationId)
        .eq('status', 'accepted')
        .select('id, status')
      if (error) {
        logger.error(`[ConsultationState][${role}][${Date.now()}] markSelfConnected — write failed:`, error)
        selfConnectedWrittenRef.current = false
      } else if (!data || data.length === 0) {
        logger.error(`[ConsultationState][${role}][${Date.now()}] markSelfConnected — 0 rows matched (status was not 'accepted' when this write ran); connected_at was NOT recorded`)
        selfConnectedWrittenRef.current = false
      } else {
        logger.log(`[ConsultationState][${role}][${Date.now()}] markSelfConnected — wrote ${role}_connected_at:${nowIso}`)
      }
    } catch (err) {
      logger.error(`[ConsultationState][${role}][${Date.now()}] markSelfConnected — threw:`, err)
      selfConnectedWrittenRef.current = false
    }
  }, [consultationId, role, getToken])

  return {
    phase: derived.phase,
    elapsedSeconds: derived.elapsedSeconds,
    startedAtIso: row?.started_at ?? null,
    isPeerConnected: role === 'doctor' ? !!row?.patient_connected_at : !!row?.doctor_connected_at,
    markSelfConnected,
    rawStatus: row?.status ?? null,
  }
}
