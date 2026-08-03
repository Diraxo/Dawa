import { useAuth } from '@clerk/clerk-expo'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import { useActiveConsultationRecovery } from '@/hooks/useActiveConsultationRecovery'
import { useIncomingConsultationAlert } from '@/hooks/useIncomingConsultationAlert'
import { useAuthStore } from '@/store/authStore'

// Same Clerk token-cache race app/(auth)/splash.tsx guards against: isLoaded
// can flip true while a returning session's isSignedIn is still resolving,
// which otherwise instantly bounces an already-signed-in doctor out of
// whatever tab they're on and back to sign-in (~1-3s later, sign-in's own
// redirect sends them to Home — reads as "tab returns to Home").
const SIGNED_OUT_RETRY_MS = 400
const MAX_SIGNED_OUT_RETRIES = 6 // ~2.4s total grace window

export default function DoctorLayout() {
  const { isSignedIn, isLoaded } = useAuth()
  const { userRole, userId: cachedUserId, _hasHydrated } = useAuthStore()
  const router = useRouter()
  const redirectedRef = useRef(false)
  const [signedOutRetries, setSignedOutRetries] = useState(0)

  useEffect(() => {
    if (!isLoaded || !_hasHydrated) return

    const guardFails = !isSignedIn || userRole !== 'doctor'

    if (!guardFails) {
      redirectedRef.current = false
      if (signedOutRetries !== 0) setSignedOutRetries(0)
      return
    }

    // Already redirected for this failure — don't fire router.replace again
    // on every re-render while the condition remains true (this was the
    // source of the stacked/repeated Login screens on rapid logout).
    if (redirectedRef.current) return

    // cachedUserId (persisted across restarts) means this device was
    // previously authenticated — a real sign-out clears it immediately
    // (see authStore.clearAuth), so its presence here means isSignedIn=false
    // is most likely transient. Give Clerk a brief grace window before
    // concluding the user is genuinely signed out.
    //
    // userRole === null while already signed in is the same kind of
    // transient gap, not a real mismatch: several post-auth redirects
    // (role.tsx's "already onboarded" bounce, sign-up.tsx's
    // checkRoleAndRedirect) navigate straight into tabs and only set the
    // store's role a moment later (or, if that call was ever missed, not at
    // all) — this must not be told apart from "still loading" here, or the
    // very first render after any such redirect bounces straight back out
    // to sign-in and immediately back again, which is exactly what reads as
    // a tab silently returning to Home. A definite wrong role (e.g. a
    // patient account on this doctor layout) is not this case and still
    // redirects immediately below.
    const roleStillResolving = isSignedIn && userRole === null
    if (((!isSignedIn && cachedUserId) || roleStillResolving) && signedOutRetries < MAX_SIGNED_OUT_RETRIES) {
      const timer = setTimeout(() => setSignedOutRetries((n) => n + 1), SIGNED_OUT_RETRY_MS)
      return () => clearTimeout(timer)
    }

    redirectedRef.current = true
    router.replace('/(auth)/sign-in' as never)
  }, [isLoaded, isSignedIn, userRole, _hasHydrated, cachedUserId, signedOutRetries])

  // DB-driven session recovery — restores the doctor straight into the
  // incoming request screen or the live consultation after app kill,
  // refresh, or backgrounding, instead of leaving them on the tabs Home.
  const doctorSessionActive = isLoaded && isSignedIn && userRole === 'doctor' && _hasHydrated
  useActiveConsultationRecovery('doctor', doctorSessionActive)

  // Global incoming-consultation detection/ring/navigate — lives here
  // (not in (tabs)/home.tsx) so it keeps running for the doctor's entire
  // session regardless of which tab or nested screen is on top. See
  // hooks/useIncomingConsultationAlert.ts for why Home was the wrong place.
  useIncomingConsultationAlert(doctorSessionActive)

  return <Stack screenOptions={{ headerShown: false }} />
}
