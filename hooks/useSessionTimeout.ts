import { useEffect, useRef, useState } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { useClerk } from '@clerk/clerk-expo'

import { supabaseEmailAuth } from '@/lib/supabase'

const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000      // 2 hours
const WARN_BEFORE_LOGOUT_MS = 10 * 60 * 1000         // warn 10 min before logout

export function useSessionTimeout() {
  const { signOut } = useClerk()
  const [showWarning, setShowWarning] = useState(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    const handleChange = async (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now()
        setShowWarning(false)
      } else if (nextState === 'active' && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current
        backgroundedAt.current = null

        if (elapsed >= INACTIVITY_LIMIT_MS) {
          try { await signOut() } catch {}
          try { await supabaseEmailAuth.auth.signOut() } catch {}
        } else if (elapsed >= INACTIVITY_LIMIT_MS - WARN_BEFORE_LOGOUT_MS) {
          setShowWarning(true)
        }
      }
    }

    const sub = AppState.addEventListener('change', handleChange)
    return () => sub.remove()
  }, [signOut])

  return { showWarning, dismissWarning: () => setShowWarning(false) }
}
