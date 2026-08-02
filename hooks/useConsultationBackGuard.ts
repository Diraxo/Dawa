import { useEffect, useRef } from 'react'
import { BackHandler } from 'react-native'
import { useNavigation } from 'expo-router'

import { useConsultationPresenceStore } from '@/store/consultationPresenceStore'

// Intercepts every way a live consultation screen (chat/phone/video, patient
// or doctor) can be left by mistake — Android hardware back (BackHandler)
// *and* the cross-platform navigation transition that also covers iOS's
// swipe-back gesture, a header back button, and any programmatic
// router.back()/goBack() — and routes all of them through the same
// screen-owned confirm handler instead of letting the stack silently pop.
// Without the `beforeRemove` half, a screen wired only to BackHandler (the
// pre-existing pattern here) has zero protection at all on iOS, since
// BackHandler is Android-only.
export function useConsultationBackGuard(enabled: boolean, onAttemptExit: () => void, consultationId?: string) {
  const navigation = useNavigation()
  const handlerRef = useRef(onAttemptExit)
  handlerRef.current = onAttemptExit
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  // Set right before the confirm dialog's own "Leave" action navigates away,
  // so that resulting removal is let through instead of being caught by our
  // own `beforeRemove` listener and re-prompting the user for a confirmation
  // they already gave.
  const bypassRef = useRef(false)

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!enabledRef.current || bypassRef.current) return false
      handlerRef.current()
      return true
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!enabledRef.current || bypassRef.current) return
      e.preventDefault()
      handlerRef.current()
    })
    return unsub
  }, [navigation])

  return {
    confirmExit: (leave: () => void) => {
      bypassRef.current = true
      // Recorded before navigating away so useActiveConsultationRecovery
      // doesn't immediately bounce the user right back into the screen they
      // just confirmed they want to leave — see consultationPresenceStore
      // for why this must be suppressed rather than just letting the
      // redirect race the navigation.
      if (consultationId) {
        useConsultationPresenceStore.getState().setVoluntarilyLeftConsultationId(consultationId)
      }
      leave()
    },
  }
}
