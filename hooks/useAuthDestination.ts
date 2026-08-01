import { useAuth } from '@clerk/clerk-expo'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getAuthClient, supabase } from '@/lib/supabase'
import { resolveAuthDestination } from '@/lib/resolveAuthDestination'

// After a screen establishes a brand-new Clerk session (e.g. password
// reset), Clerk's own `userId`/`isSignedIn` from useAuth() can lag a render
// or two behind the awaited setActive() call — so resolution is deferred to
// an effect that fires once they actually update, mirroring the pattern
// already used in sign-in.tsx/splash.tsx, rather than reading them
// synchronously right after setActive.
//
// On lookup failure this retries a few times and then surfaces `error` —
// it never falls back to Role Selection, since that would misroute an
// existing patient/doctor whose only problem was a flaky connection.
export function useAuthDestination(onResolved: (dest: { route: string; role: 'patient' | 'doctor' | null }) => void) {
  const { isSignedIn, userId, getToken } = useAuth()
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const attempt = useCallback(async () => {
    if (!userId) return
    setError(false)
    for (let i = 0; i < 3; i++) {
      try {
        const token = await getToken()
        const client = token ? getAuthClient(token) : supabase
        const dest = await resolveAuthDestination(client, userId)
        if (!mountedRef.current) return
        onResolved(dest)
        return
      } catch {
        if (i < 2) await new Promise((resolve) => setTimeout(resolve, 800))
      }
    }
    if (mountedRef.current) setError(true)
  }, [userId, getToken, onResolved])

  useEffect(() => {
    if (armed && isSignedIn && userId) attempt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, isSignedIn, userId])

  return {
    arm: useCallback(() => setArmed(true), []),
    retry: attempt,
    error,
  }
}
