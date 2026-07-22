// Shared "where does this notification go" routing logic — used both by the
// push/Notifee tap handlers in app/_layout.tsx and by the in-app Notification
// Center (components/notifications/NotificationCenterView.tsx) tapping a row
// directly. Extracted so both paths stay behaviorally identical instead of
// two independently-maintained copies of the same switch.
import { supabase } from '@/lib/supabase'
import { callkeep } from '@/lib/callkeep'
import { useAuthStore } from '@/store/authStore'

type RouterLike = {
  push: (opts: any) => void
  replace: (opts: any) => void
  setParams?: (opts: any) => void
  dismissTo: (opts: any) => void
}

// A loose shape matching React Navigation's NavigationState — deliberately
// untyped against @react-navigation's actual types so this lib doesn't take
// on that dependency. Supplied by callers via
// useNavigationContainerRef().current?.getRootState(), read fresh at
// tap-time (not cached in a ref-on-render like CurrentDoctorRoute below),
// so it always reflects the live stack.
export type NavStateSnapshot = { routes?: Array<{ name: string; params?: any; state?: NavStateSnapshot }> } | null | undefined

// Where the doctor is *right now* — supplied by the caller (app/_layout.tsx's
// notification-tap handlers, the in-app Notification Center) via
// usePathname()/useGlobalSearchParams() so a notification tap can tell
// "already viewing this" from "need to navigate", and so a stale/resolved
// consultation-family screen still frozen on the stack gets replaced instead
// of having the destination pushed on top of it. Doctor-app only — patient
// navigation below never receives this and is unaffected.
export type CurrentDoctorRoute = {
  pathname: string
  consultationId?: string | null
  highlightConsultationId?: string | null
}

const DOCTOR_CONSULTATION_FAMILY_PATHNAMES = new Set([
  '/(doctor)/incoming-request',
  '/(doctor)/chat-consultation',
  '/(doctor)/video-consultation',
  '/(doctor)/phone-consultation',
])

// Leaf screen names (React Navigation's route.name — the file name minus
// its route group) for every screen that must never have more than one
// live instance on the stack at once, across BOTH the doctor and patient
// apps. Used to scan the *entire* navigation tree rather than just the
// current top route, so a screen frozen several levels down (e.g. behind
// the in-app Notification Center, or under a tab navigator) is still found.
const CONSULTATION_FAMILY_LEAF_NAMES = new Set([
  'incoming-request',
  'chat-consultation',
  'video-consultation',
  'phone-consultation',
  'waiting-room',
  'my-reviews',
])

// Route groups (the "(doctor)" folder) never appear in usePathname()'s
// output, only in the pathnames used for actual push/replace calls — strip
// it so the two can be compared directly.
function stripRouteGroup(pathname: string): string {
  return pathname.replace(/^\/\([^/]+\)/, '')
}

function leafName(pathname: string): string {
  return pathname.split('/').filter(Boolean).pop() ?? pathname
}

// Recursively scans every nested navigator in the tree (not just the
// current top route) for a screen with the given leaf name.
function routeExistsInTree(state: NavStateSnapshot, name: string): boolean {
  if (!state?.routes) return false
  for (const route of state.routes) {
    if (route.name === name) return true
    if (route.state && routeExistsInTree(route.state, name)) return true
  }
  return false
}

// Shared by both the doctor and patient consultation-family navigations:
// if an instance of the target screen already exists ANYWHERE in the
// navigation tree, pop/update that instance (bringing it to the front)
// instead of stacking a duplicate. Falls back to a plain push/replace only
// when nothing is found (or no snapshot was available to check).
export function navigateFamilyRoute(
  router: RouterLike,
  rootState: NavStateSnapshot,
  targetPathname: string,
  params: Record<string, string>,
  defaultAction: 'push' | 'replace',
) {
  const name = leafName(targetPathname)
  if (CONSULTATION_FAMILY_LEAF_NAMES.has(name) && rootState && routeExistsInTree(rootState, name)) {
    router.dismissTo({ pathname: targetPathname as any, params })
    return
  }
  if (defaultAction === 'replace') router.replace({ pathname: targetPathname as any, params })
  else router.push({ pathname: targetPathname as any, params })
}

// Shared decision behind every doctor consultation-family navigation
// (Incoming Consultation, Chat/Voice/Video Consultation): never stack a
// second instance of the same screen+consultation, and never leave a stale
// one behind when redirecting elsewhere.
export function navigateDoctorConsultationRoute(
  router: RouterLike,
  currentRoute: CurrentDoctorRoute | undefined,
  targetPathname: string,
  params: Record<string, string>,
  defaultAction: 'push' | 'replace',
  // Full navigation-tree snapshot (see NavStateSnapshot) — optional only so
  // this stays callable from places that genuinely can't get one yet;
  // every real call site below supplies it.
  rootState?: NavStateSnapshot,
) {
  const currentPathname = currentRoute?.pathname
  const targetIsFamily = DOCTOR_CONSULTATION_FAMILY_PATHNAMES.has(targetPathname)

  if (
    targetIsFamily &&
    currentPathname === stripRouteGroup(targetPathname) &&
    (currentRoute?.consultationId ?? null) === (params.consultationId ?? null)
  ) {
    // Already on exactly this screen for exactly this consultation —
    // nothing to navigate, the caller still marks the notification read.
    return
  }

  if (rootState) {
    // Scans the WHOLE stack, not just the screen directly underneath the
    // current one — catches a consultation-family screen frozen several
    // levels down (e.g. behind the in-app Notification Center, or behind a
    // tab navigator) that a pathname-only comparison would miss entirely.
    navigateFamilyRoute(router, rootState, targetPathname, params, defaultAction)
    return
  }

  if (
    currentPathname &&
    DOCTOR_CONSULTATION_FAMILY_PATHNAMES.has(`/(doctor)${currentPathname}`) &&
    stripRouteGroup(targetPathname) !== currentPathname
  ) {
    // No stack snapshot available — fall back to only detecting a stale
    // screen directly underneath the current one (the old, narrower check).
    router.replace({ pathname: targetPathname as any, params })
    return
  }

  if (defaultAction === 'replace') router.replace({ pathname: targetPathname as any, params })
  else router.push({ pathname: targetPathname as any, params })
}

// A doctor tapping an "incoming request" notification/full-screen alert may
// do so well after it was sent — the consultation could already be
// accepted (from another device), cancelled, declined, or expired by then.
// The notification payload is only a snapshot from send time, not live
// truth, so re-check before deciding where to route.
export async function resolveIncomingRequestRoute(
  data: Record<string, any>
): Promise<{ pathname: string; params: Record<string, string> }> {
  const consultationId = data.consultationId as string | undefined
  if (!consultationId) return { pathname: '/(doctor)/(tabs)/consultations', params: {} }

  const { data: row } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .maybeSingle()
  const liveStatus = row?.status

  if (liveStatus === 'waiting_for_doctor') {
    return {
      pathname: '/(doctor)/incoming-request',
      params: {
        consultationId,
        consultationType: (data.consultationType as string | undefined) ?? 'chat',
        patientName:      data.patientName    ?? 'Patient',
        patientId:        data.patientId      ?? '',
        patientClerkId:   data.patientClerkId ?? '',
        waitingStartedAt: data.waitingStartedAt ?? '',
      },
    }
  }

  // No longer an incoming request — completed/cancelled/declined/expired, or
  // already accepted/in progress (possibly from another device). Land on the
  // consultation's own history/details entry instead of the dead request.
  if (liveStatus === 'completed') {
    return {
      pathname: '/(doctor)/consultation-summary',
      params: { consultationId, patientName: (data.patientName as string | undefined) ?? 'Patient' },
    }
  }
  return { pathname: '/(doctor)/(tabs)/consultations', params: {} }
}

// Routes to the right screen for a notification's `data` payload — shared by
// push taps, Notifee taps, and the in-app Notification Center.
export function navigateForNotification(
  router: RouterLike,
  userRole: string | null,
  data: Record<string, any>,
  currentRoute?: CurrentDoctorRoute,
  rootState?: NavStateSnapshot,
) {
  const { screen, consultationId, consultationType, channelId } = data ?? {}

  // Set synchronously, before any navigation below runs, so splash.tsx's
  // own (later-resolving) default-role redirect can see it was beaten to
  // the punch by a real notification deep link and skip stomping over it
  // with a Home replace.
  if (screen) useAuthStore.getState().setPendingNotificationRoute(true)

  // Dismiss any active CallKeep call screen for this consultation
  // (patient tapped the notification instead of the OS call UI)
  if (consultationId && callkeep.isCallActive(consultationId)) {
    callkeep.endIncomingCall(consultationId)
  }

  switch (screen) {
    case 'appointments':
      router.push('/(patient)/(tabs)/appointments')
      break

    case 'chat':
      if (channelId) {
        if (userRole === 'doctor') {
          navigateDoctorConsultationRoute(
            router,
            currentRoute,
            '/(doctor)/chat-consultation',
            { channelId, consultationId: channelId },
            'push',
            rootState,
          )
        } else {
          navigateFamilyRoute(router, rootState, '/(patient)/chat-consultation', { channelId }, 'push')
        }
      } else if (userRole === 'doctor') {
        router.push('/(doctor)/(tabs)/messages')
      } else {
        router.push('/(patient)/(tabs)/messages')
      }
      break

    case 'consultation': {
      if (consultationId) {
        const type = consultationType ?? 'chat'
        if (userRole === 'doctor') {
          const pathname =
            type === 'video'
              ? '/(doctor)/video-consultation'
              : type === 'phone'
              ? '/(doctor)/phone-consultation'
              : '/(doctor)/chat-consultation'
          navigateDoctorConsultationRoute(
            router,
            currentRoute,
            pathname,
            {
              consultationId,
              channelId: consultationId,
              patientName:    data.patientName    ?? 'Patient',
              patientId:      data.patientId      ?? '',
              patientPhotoUrl: data.patientPhotoUrl ?? '',
            },
            'replace',
            rootState,
          )
        } else {
          const pathname =
            type === 'video'
              ? '/(patient)/video-consultation'
              : type === 'phone'
              ? '/(patient)/phone-consultation'
              : '/(patient)/chat-consultation'
          navigateFamilyRoute(
            router,
            rootState,
            pathname,
            {
              consultationId,
              channelId: consultationId,
              doctorName:    data.doctorName ?? 'Doctor',
              doctorId:      data.doctorId   ?? '',
              doctorPhotoUrl: data.doctorPhotoUrl ?? '',
              fromCallkeep:  '1',
            },
            'replace',
          )
        }
      } else {
        router.replace(userRole === 'doctor' ? '/(doctor)/(tabs)/consultations' : '/(patient)/(tabs)/appointments')
      }
      break
    }

    case 'waiting-room':
    case 'waiting':
      if (consultationId) {
        // The notification could be stale by the time it's tapped — the
        // doctor may have already accepted (or the call may already be
        // live) in the time between it being sent and the tap. Check the
        // live status rather than trusting the notification's payload, so
        // an already-accepted consultation never gets routed through the
        // waiting room at all.
        supabase
          .from('consultations')
          .select('status')
          .eq('id', consultationId)
          .maybeSingle()
          .then(({ data: row }) => {
            const liveStatus = row?.status
            if (liveStatus === 'accepted' || liveStatus === 'in_progress' || liveStatus === 'active') {
              const type = consultationType ?? 'chat'
              const pathname =
                type === 'video' ? '/(patient)/video-consultation' :
                type === 'phone' ? '/(patient)/phone-consultation' :
                '/(patient)/chat-consultation'
              navigateFamilyRoute(
                router,
                rootState,
                pathname,
                {
                  consultationId,
                  channelId: consultationId,
                  doctorName: data.doctorName ?? 'Doctor',
                  doctorId:   data.doctorId   ?? '',
                  doctorPhotoUrl: data.doctorPhotoUrl ?? '',
                  // The call is already accepted/live by the time this
                  // stale "waiting" notification is tapped — without
                  // this, the phone/video screen defaults to its ringing
                  // UI (fromCallkeep unset, resumeElapsed unset) and
                  // shows a ghost "Doctor is calling you…" auto-decline
                  // countdown over an already-connected or since-ended
                  // call, which can even re-write status:'missed' again.
                  fromCallkeep: '1',
                },
                'replace',
              )
            } else {
              navigateFamilyRoute(
                router,
                rootState,
                '/(patient)/waiting-room',
                {
                  consultationId,
                  consultationType: consultationType ?? 'chat',
                  doctorName: data.doctorName ?? 'Doctor',
                  doctorId:   data.doctorId   ?? '',
                },
                'push',
              )
            }
          })
      } else {
        router.push('/(patient)/(tabs)/appointments')
      }
      break

    case 'incoming_request':
      if (consultationId) {
        resolveIncomingRequestRoute(data).then(route =>
          navigateDoctorConsultationRoute(router, currentRoute, route.pathname, route.params, 'push', rootState),
        )
      } else {
        router.push('/(doctor)/(tabs)/consultations')
      }
      break

    case 'consultation_summary':
      if (consultationId) {
        router.push({ pathname: '/(patient)/consultation-summary', params: { consultationId } })
      } else {
        router.push('/(patient)/(tabs)/appointments')
      }
      break

    case 'consultations':
      // Also reached by cancellation notifications — if a stale Incoming
      // Consultation (or other consultation-family screen) for a request
      // that's no longer live is still frozen on the stack, discard it
      // instead of pushing the Consultations tab on top of it.
      navigateDoctorConsultationRoute(router, currentRoute, '/(doctor)/(tabs)/consultations', {}, 'push', rootState)
      break

    // Scheduled-booking / reschedule notifications — the Consultations
    // tab's "incoming" bucket only shows waiting_for_doctor/pending rows,
    // so a 'scheduled' consultation opened there was previously
    // unclickable dead weight. Schedule is the doctor's actual upcoming-
    // appointments view.
    case 'schedule':
      router.push('/(doctor)/(tabs)/schedule')
      break

    case 'profile':
      // A rating notification also carries screen: 'profile' (so a stale
      // client/carehub-web that doesn't know about notifKind still lands
      // somewhere sane) — but here it should open the specific rating
      // instead of the generic profile tab.
      if (userRole === 'doctor' && data.notifKind === 'rating' && consultationId) {
        const myReviewsParams = { highlightConsultationId: consultationId }
        if (rootState) {
          // Reuses a My Reviews instance frozen anywhere in the stack
          // (including the current screen itself) and updates its
          // highlight in place, instead of stacking a second copy.
          navigateFamilyRoute(router, rootState, '/(doctor)/my-reviews', myReviewsParams, 'push')
        } else if (currentRoute?.pathname === '/my-reviews' && router.setParams) {
          // No stack snapshot available — fall back to the narrower
          // current-screen-only check.
          router.setParams(myReviewsParams)
        } else {
          router.push({ pathname: '/(doctor)/my-reviews', params: myReviewsParams })
        }
      } else if (userRole === 'doctor') {
        router.push('/(doctor)/(tabs)/profile')
      } else {
        router.push('/(patient)/(tabs)/profile')
      }
      break

    default:
      break
  }
}
