'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { CallPhase, Role } from './useConsultationState'

export type ConsultationKind = 'chat' | 'phone' | 'video'

interface UseConsultationCompletionArgs {
  phase: CallPhase
  rawStatus: string | null
  role: Role
  kind: ConsultationKind
  consultationId: string | undefined
  onTeardown: () => void
}

// The one place every chat/phone/video page (both roles) reacts to a
// consultation reaching a terminal status. Detection itself still lives in
// useConsultationState (mount fetch + realtime + poll) — this hook only owns
// the "fire exactly once" guard, the type-specific teardown callback, and (for
// patients) the completion-modal + summary-navigation wiring that used to be
// copy-pasted per page. Doctor pages intentionally get no modal here — that
// asymmetry (a plain "Call Ended" panel + navigate-to-list vs. modal +
// navigate-to-summary) is a deliberate, preserved product decision, not
// something this hook should paper over. Mirrors hooks/useConsultationCompletion.ts
// on mobile — the two can't share JS, but must agree on this contract.
export function useConsultationCompletion({
  phase,
  rawStatus,
  role,
  kind,
  consultationId,
  onTeardown,
}: UseConsultationCompletionArgs) {
  const router = useRouter()
  const handledRef = useRef(false)
  const [showCompletedModal, setShowCompletedModal] = useState(false)
  const onTeardownRef = useRef(onTeardown)
  onTeardownRef.current = onTeardown

  useEffect(() => {
    if (phase !== 'ended' || handledRef.current) return
    handledRef.current = true
    onTeardownRef.current()
    if (role === 'patient') setShowCompletedModal(true)
  }, [phase, role])

  // Lets a self-initiated "End Consultation" action (which does its own
  // immediate teardown + navigation, without waiting on realtime) suppress
  // this hook's reactive effect — otherwise the realtime echo of that same
  // status write arrives moments later and fires onTeardown a second time.
  const markHandled = useCallback(() => {
    handledRef.current = true
  }, [])

  const goToSummary = useCallback(() => {
    setShowCompletedModal(false)
    router.push(`/patient/summary/${consultationId}`)
  }, [router, consultationId])

  const dismissModal = useCallback(() => {
    setShowCompletedModal(false)
    // Chat stays in place, read-only, on top of the (now frozen) transcript —
    // phone/video have no "in place" screen left once the call has torn
    // down, so they navigate back to the patient dashboard.
    if (kind === 'chat') return
    router.push('/patient')
  }, [router, kind])

  return {
    isCompleted: phase === 'ended',
    rawStatus,
    showCompletedModal: role === 'patient' && showCompletedModal,
    goToSummary,
    dismissModal,
    markHandled,
  }
}
