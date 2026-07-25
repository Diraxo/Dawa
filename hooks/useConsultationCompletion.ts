import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { logger } from '@/lib/logger'

import type { CallPhase, Role } from './useConsultationState'

export type ConsultationKind = 'chat' | 'phone' | 'video'

interface UseConsultationCompletionArgs {
  phase: CallPhase
  rawStatus: string | null
  role: Role
  kind: ConsultationKind
  consultationId: string | undefined
  doctorId?: string | null
  doctorName?: string | null
  onTeardown: () => void
}

// The one place every chat/phone/video screen (both roles) reacts to a
// consultation reaching a terminal status. Detection itself still lives in
// useConsultationState (mount fetch + realtime + poll) — this hook only owns
// the "fire exactly once" guard, the type-specific teardown callback, and (for
// patients) the completion-modal + summary-navigation wiring that used to be
// copy-pasted per screen. Doctor screens intentionally get no modal here —
// that asymmetry (Alert.alert + navigate-to-list vs. modal + navigate-to-
// summary) is a deliberate, preserved product decision, not something this
// hook should paper over.
export function useConsultationCompletion({
  phase,
  rawStatus,
  role,
  kind,
  consultationId,
  doctorId,
  doctorName,
  onTeardown,
}: UseConsultationCompletionArgs) {
  const handledRef = useRef(false)
  const [showCompletedModal, setShowCompletedModal] = useState(false)
  const onTeardownRef = useRef(onTeardown)
  onTeardownRef.current = onTeardown

  useEffect(() => {
    if (phase !== 'ended' || handledRef.current) return
    handledRef.current = true
    onTeardownRef.current()
    if (role === 'patient') setShowCompletedModal(true)

    // Dismiss any still-presented notification tied to this consultation
    // (e.g. an "accepted — tap to join" push sitting in the tray) — without
    // this, tapping it later re-enters the call/incoming-call flow for a
    // consultation that has already ended, which is exactly how a ghost
    // incoming-call screen can reappear.
    if (consultationId) {
      Notifications.getPresentedNotificationsAsync()
        .then(presented => {
          const stale = presented.filter(n => n.request.content.data?.consultationId === consultationId)
          stale.forEach(n => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {}))
        })
        .catch(e => logger.warn('[useConsultationCompletion] getPresentedNotificationsAsync failed:', e))
    }
  }, [phase, role, consultationId])

  // Lets a self-initiated "End Consultation" action (which does its own
  // immediate teardown + navigation, without waiting on realtime) suppress
  // this hook's reactive effect — otherwise the realtime echo of that same
  // status write arrives moments later and fires onTeardown a second time.
  const markHandled = useCallback(() => {
    handledRef.current = true
  }, [])

  const goToSummary = useCallback(() => {
    setShowCompletedModal(false)
    // Chat pushes (so back-navigation returns to the now-read-only
    // transcript); phone/video replace (there is no live call screen left to
    // go back to once the call has torn down) — matches pre-consolidation
    // per-type behavior exactly.
    const nav = kind === 'chat' ? router.push : router.replace
    nav({
      pathname: '/(patient)/consultation-summary' as any,
      params: { consultationId, doctorId, doctorName, consultationType: kind },
    } as any)
  }, [kind, consultationId, doctorId, doctorName])

  const dismissModal = useCallback(() => {
    setShowCompletedModal(false)
    // Chat stays in place, read-only, on top of the (now frozen) transcript —
    // phone/video have no "in place" screen left to show once the call has
    // torn down, so they navigate back to the messages tab. router.back()
    // pops to the already-mounted tabs instance that pushed this call screen
    // in the first place — router.replace() would instead push a *second*
    // (tabs) navigator instance on top (replace swaps only the current stack
    // entry, it doesn't reuse an earlier matching one further down), leaving
    // the original — with Home's realtime subscriptions/poll interval or
    // Messages' Stream listeners still live — orphaned underneath,
    // permanently mounted and invisible. This path runs on every single
    // phone/video call a patient dismisses without viewing the summary.
    if (kind === 'chat') return
    if (router.canGoBack()) router.back()
    else router.replace('/(patient)/(tabs)/messages' as never)
  }, [kind])

  return {
    isCompleted: phase === 'ended',
    rawStatus,
    showCompletedModal: role === 'patient' && showCompletedModal,
    goToSummary,
    dismissModal,
    markHandled,
  }
}
