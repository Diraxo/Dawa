import { useEffect, useRef } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from '@clerk/clerk-expo'
import { AppState, AppStateStatus } from 'react-native'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'

import { getAuthClient } from '@/lib/supabase'
import { ghostDebug } from '@/lib/logger'
import { resolveActiveConsultationRoute, type Role } from '@/lib/activeConsultationRecovery'
import { useConsultationPresenceStore } from '@/store/consultationPresenceStore'

// Screens that already own their own realtime/poll-driven navigation for
// their own status transitions (waiting-room watches for 'accepted' itself,
// the live call/chat screens watch for 'ended' themselves). Skipping this
// hook's own redirect while one of them is on screen avoids two independent
// mechanisms racing to router.replace the same transition — which otherwise
// surfaces as a duplicated consultation screen for the patient.
const OWN_NAVIGATION_SEGMENTS = [
  'waiting-room',
  'incoming-request',
  'phone-consultation',
  'video-consultation',
  'chat-consultation',
]

/**
 * DB-driven (not AsyncStorage-driven) active-consultation finder. Runs on
 * mount and whenever the app returns to the foreground, and hard-navigates
 * (router.replace) into the correct waiting room / incoming request /
 * live consultation screen for whichever consultation is still active for
 * this patient or doctor — regardless of how the app was closed (kill,
 * background, refresh) or which device/session last touched it.
 */
export function useActiveConsultationRecovery(role: Role, enabled: boolean) {
  const router = useRouter()
  const segments = useSegments()
  const isOnOwnNavigationScreen = segments.some(seg =>
    OWN_NAVIGATION_SEGMENTS.some(s => seg.includes(s))
  )
  const { getToken, userId: clerkUserId, isSignedIn } = useAuth()
  const lastRedirectKeyRef = useRef<string | null>(null)
  const checkingRef = useRef(false)
  // Set when a trigger (segment change, foreground, reconnect) fires while a
  // check is already in flight. Without this, that trigger's check() call
  // sees checkingRef held and returns immediately with no work done and
  // nothing scheduled to retry it — e.g. a notification tap starts a check,
  // then the user taps another tab before it resolves; the second segment
  // change's check() is dropped silently and that tab's own redirect never
  // runs until some later foreground/reconnect happens to fire.
  const pendingRecheckRef = useRef(false)
  const setHasActiveConsultation = useConsultationPresenceStore((s) => s.setHasActiveConsultation)
  const voluntarilyLeftConsultationId = useConsultationPresenceStore((s) => s.voluntarilyLeftConsultationId)
  const setVoluntarilyLeftConsultationId = useConsultationPresenceStore((s) => s.setVoluntarilyLeftConsultationId)

  // Once the redirect has landed the user back on the consultation's own
  // screen, forget the last redirect key. Without this, `lastRedirectKeyRef`
  // stayed set to the same consultationId:status forever after the *first*
  // correction, so a second accidental navigation-away with an unchanged
  // status (e.g. tapping Home again) silently failed to redirect — this is
  // the "sometimes redirected back, sometimes not" inconsistency: the guard
  // must re-arm every time the user is confirmed back on-track, not just once.
  // Also re-arms the voluntary-leave suppression below — being back on the
  // consultation's own screen at all (whether they re-opened it themselves
  // or a fresh redirect landed them there) means any earlier "I chose to
  // leave this one" note is no longer relevant.
  useEffect(() => {
    if (isOnOwnNavigationScreen) {
      lastRedirectKeyRef.current = null
      setVoluntarilyLeftConsultationId(null)
    }
  }, [isOnOwnNavigationScreen, setVoluntarilyLeftConsultationId])

  useEffect(() => {
    if (!enabled || !isSignedIn || !clerkUserId || isOnOwnNavigationScreen) return

    const check = async () => {
      if (checkingRef.current) {
        pendingRecheckRef.current = true
        return
      }
      checkingRef.current = true
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: userRow } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', clerkUserId)
          .maybeSingle()
        if (!userRow) return

        const resolved = await resolveActiveConsultationRoute(client, role, userRow.id)
        // The one consultation this user just explicitly chose to step away
        // from (via useConsultationBackGuard's confirmExit) while it keeps
        // running without them — must not be force-navigated back into, and
        // must not block the tabs layout below either, or the "Leave"
        // confirmation they just gave becomes a no-op.
        const suppressed = !!resolved && resolved.consultationId === voluntarilyLeftConsultationId
        setHasActiveConsultation(!!resolved && !suppressed)
        if (!resolved || suppressed) return

        const key = `${resolved.consultationId}:${resolved.status}`
        if (lastRedirectKeyRef.current === key) return
        ghostDebug('[active-consultation-restoration] useActiveConsultationRecovery redirecting', {
          role, consultationId: resolved.consultationId, status: resolved.status, pathname: resolved.pathname,
        })
        lastRedirectKeyRef.current = key

        router.replace({ pathname: resolved.pathname as any, params: resolved.params })
      } catch {
        // Best-effort — next mount/foreground/tab-focus retries.
      } finally {
        checkingRef.current = false
        if (pendingRecheckRef.current) {
          pendingRecheckRef.current = false
          check()
        }
      }
    }

    check()

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check()
    })

    let wasOffline = false
    const netSub = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = !!state.isConnected && state.isInternetReachable !== false
      if (!isOnline) {
        wasOffline = true
      } else if (wasOffline) {
        wasOffline = false
        check()
      }
    })

    return () => {
      sub.remove()
      netSub()
    }
  // segments.join('/') is intentional: re-run `check()` on every tab/screen
  // navigation (not just mount/foreground/reconnect) so switching from Home
  // to Messages/Profile/Appointments/etc. while a consultation is
  // accepted/in_progress redirects back into it immediately, matching how
  // the web recovery components already re-check on every pathname change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSignedIn, clerkUserId, isOnOwnNavigationScreen, segments.join('/'), voluntarilyLeftConsultationId])
}
