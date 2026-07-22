import '../global.css'
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Monitoring } from '@/lib/monitoring'
import ActiveCallBanner from '@/components/ui/ActiveCallBanner'

// Initialize error monitoring (Sentry) as early as possible
Monitoring.init()
import i18n, { LANGUAGE_STORAGE_KEY } from '@/lib/i18n'
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from '@expo-google-fonts/montserrat'
import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo'
import * as Notifications from 'expo-notifications'
import { SplashScreen, Stack, useGlobalSearchParams, useNavigationContainerRef, usePathname, useRouter, useSegments } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, AppStateStatus, Platform, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useStreamConnection } from '@/hooks/useStreamConnection'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useOngoingConsultationNotification } from '@/hooks/useOngoingConsultationNotification'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { streamClient } from '@/lib/stream'
import { getAuthClient, setClerkTokenGetter, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useActiveChatStore } from '@/store/activeChatStore'
import ForceUpdateScreen from '@/components/shared/ForceUpdateScreen'
import OfflineStartScreen from '@/components/shared/OfflineStartScreen'
import NetworkBanner from '@/components/ui/NetworkBanner'
import { callkeep, type IncomingCallPayload } from '@/lib/callkeep'
import { registerCallTokens, handleIncomingCallData } from '@/lib/voipPush'
import { logger } from '@/lib/logger'
import { navigateDoctorConsultationRoute, navigateFamilyRoute, navigateForNotification, resolveIncomingRequestRoute, type CurrentDoctorRoute } from '@/lib/notificationNav'
import { markNotificationRead, refreshBadge } from '@/lib/notificationCenter'

// Mirrors TERMINAL_STATUSES in hooks/useConsultationState.ts — any status here
// means the consultation is over and the persisted "active" banner must clear.
const GHOST_TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled',
  'declined',
  'doctor_missed',
  'missed',
  'call_declined',
  'ended_abnormally',
])

// OverlayProvider is required lazily so this layout file doesn't crash in Expo Go
let OverlayProvider: React.ComponentType<{ children: React.ReactNode }> =
  ({ children }) => <>{children}</>
try {
  OverlayProvider = require('stream-chat-expo').OverlayProvider
} catch {}

// VoIP push notification module (iOS only, lazy)
let RNVoipPush: any = null
try {
  if (Platform.OS === 'ios') {
    RNVoipPush = require('react-native-voip-push-notification').default
  }
} catch {}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!

// Clerk rotates its client JWT on every request: each call must present the
// token saved from the *previous* response, and the server hands back a new
// one to persist for the *next* call. A raw AsyncStorage-backed cache has no
// synchronous fast path, so concurrent getToken() calls (e.g. several tab
// screens mounting at once and each triggering a session/token check) can
// race — one call's in-flight AsyncStorage read can return a token that's
// already been superseded by another call's not-yet-flushed write, making
// Clerk reject it and isSignedIn flicker false for ~1-3s. Layering an
// in-memory cache in front closes that window: same-process reads/writes
// resolve synchronously, matching Clerk's own default MemoryTokenCache
// behavior, while still persisting to AsyncStorage for cold starts.
const memTokenCache = new Map<string, string>()
const tokenCache = {
  async getToken(key: string) {
    if (memTokenCache.has(key)) return memTokenCache.get(key)!
    const value = await AsyncStorage.getItem(key)
    if (value) memTokenCache.set(key, value)
    return value
  },
  async saveToken(key: string, value: string) {
    memTokenCache.set(key, value)
    return AsyncStorage.setItem(key, value)
  },
  async clearToken(key: string) {
    memTokenCache.delete(key)
    return AsyncStorage.removeItem(key)
  },
}

SplashScreen.preventAutoHideAsync()

const CONSULTATION_SEGMENTS = [
  'phone-consultation',
  'video-consultation',
  'chat-consultation',
]

// ─── Inner component — must be inside ClerkProvider ──────────────────────────

function AppInitializer() {
  const router = useRouter()
  const { userId, userRole, isStreamConnected } = useAuthStore()
  const { getToken, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()

  // Inject Clerk's getToken into the Supabase client
  useEffect(() => {
    if (isSignedIn) {
      setClerkTokenGetter(() => getToken())
    } else {
      setClerkTokenGetter(null)
    }
  }, [isSignedIn, getToken])

  useStreamConnection()

  // ── Doctor notification-tap dedup: where are we right now? ────────────────
  // Read fresh inside the tap handlers below (registered once per
  // [userRole]/[userRole, userId] effect run, so their closures would
  // otherwise see a stale route) — see lib/notificationNav.ts's
  // navigateDoctorConsultationRoute for how this prevents a notification tap
  // from stacking a second Incoming Consultation/Chat/Voice/Video screen on
  // top of one that's already showing.
  const doctorRoutePathname = usePathname()
  const doctorRouteParams = useGlobalSearchParams<{ consultationId?: string; highlightConsultationId?: string }>()
  const currentDoctorRouteRef = useRef<CurrentDoctorRoute>({ pathname: doctorRoutePathname, consultationId: null, highlightConsultationId: null })
  useEffect(() => {
    currentDoctorRouteRef.current = {
      pathname: doctorRoutePathname,
      consultationId: doctorRouteParams.consultationId ?? null,
      highlightConsultationId: doctorRouteParams.highlightConsultationId ?? null,
    }
  }, [doctorRoutePathname, doctorRouteParams.consultationId, doctorRouteParams.highlightConsultationId])

  // Full navigation-tree snapshot, read fresh at tap-time rather than kept
  // in a ref-on-render — lets navigateForNotification/navigateDoctorConsultationRoute
  // scan every screen currently on the stack (not just the current top
  // route) when deciding whether a consultation-family screen already
  // exists somewhere and should be reused instead of duplicated.
  const navContainerRef = useNavigationContainerRef()
  const getNavRootState = () => navContainerRef.current?.getRootState()

  // Restore saved language preference on every cold start
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((code) => {
      if (code && code !== i18n.language) i18n.changeLanguage(code)
    })
  }, [])

  usePushNotifications()
  useOngoingConsultationNotification()

  // ── Notifee notification tap (Android, foreground/background-alive) ──────
  // Mirrors the relevant cases of the expo-notifications tap handler below,
  // but for Notifee-driven notifications (the sticky ongoing-call banner and
  // the full-screen incoming-request alert), whose press events don't go
  // through expo-notifications at all.
  const navigateFromNotifeeData = (data: Record<string, any>) => {
    if (data.screen === 'incoming_request') {
      const consultationId = data.consultationId as string | undefined
      if (!consultationId) return
      resolveIncomingRequestRoute(data).then(route =>
        navigateDoctorConsultationRoute(router, currentDoctorRouteRef.current, route.pathname, route.params, 'push', getNavRootState()),
      )
      return
    }

    const consultationId   = data.consultationId as string | undefined
    const consultationType = (data.consultationType as string | undefined) ?? 'chat'
    if (!consultationId) return
    const pathname =
      userRole === 'doctor'
        ? (consultationType === 'video' ? '/(doctor)/video-consultation' : consultationType === 'phone' ? '/(doctor)/phone-consultation' : '/(doctor)/chat-consultation')
        : (consultationType === 'video' ? '/(patient)/video-consultation' : consultationType === 'phone' ? '/(patient)/phone-consultation' : '/(patient)/chat-consultation')
    const params = { consultationId, channelId: consultationId }
    if (userRole === 'doctor') {
      navigateDoctorConsultationRoute(router, currentDoctorRouteRef.current, pathname, params, 'replace', getNavRootState())
    } else {
      navigateFamilyRoute(router, getNavRootState(), pathname, params, 'replace')
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return
    let notifee: any = null
    try { notifee = require('@notifee/react-native').default } catch { return }
    if (!notifee?.onForegroundEvent) return

    const unsubscribe = notifee.onForegroundEvent(({ type, detail }: any) => {
      // EventType.PRESS === 1 — avoided importing the enum here so this
      // stays safe even if @notifee/react-native isn't linked yet.
      if (type !== 1) return
      navigateFromNotifeeData(detail?.notification?.data ?? {})
    })

    // Cold start: the app was fully killed and launched by tapping the
    // full-screen incoming-request notification (or its fullScreenAction).
    // Unlike the ongoing-call notification (which in practice never fires
    // while the app process is fully dead — a live call keeps it alive),
    // the incoming-request notification is specifically meant to reach a
    // killed/locked device, so a cold-start deep link here is the common
    // case, not an edge case.
    notifee.getInitialNotification?.().then((initial: any) => {
      if (!initial?.notification?.data) return
      navigateFromNotifeeData(initial.notification.data)
    }).catch(() => {})

    return () => unsubscribe?.()
  }, [userRole])

  // ── CallKeep initialisation + incoming-call wiring ───────────────────────
  // Must be inside a component so we have access to `router`.
  const callkeepInitRef = useRef(false)
  const pendingAnswerRef = useRef<IncomingCallPayload | null>(null)

  // Navigate patient/doctor to the right screen when they answer via the OS
  // call screen. direction === 'doctor' is a patient's on-demand request
  // ringing the doctor's device (see supabase/functions/handle-consultation-
  // notification's 'new_request' case + lib/callkeep.ts) — Accept there
  // opens the existing incoming-request screen (payment re-check, Stream
  // channel creation, decline-reason flow all still apply) rather than
  // jumping straight into the call the way a patient answering an
  // already-doctor-accepted call does.
  const navigateToConsultation = (payload: IncomingCallPayload) => {
    if (payload.direction === 'doctor') {
      if (userRole !== 'doctor' && userRole !== null) return
      router.replace({
        pathname: '/(doctor)/incoming-request' as any,
        params: {
          patientName:      payload.patientName ?? 'Patient',
          patientId:        payload.patientId ?? '',
          patientClerkId:   payload.patientClerkId ?? '',
          patientPhotoUrl:  payload.patientPhotoUrl ?? '',
          consultationType: payload.consultationType,
          consultationId:   payload.consultationId,
        },
      })
      return
    }

    if (userRole !== 'patient' && userRole !== null) return // doctors don't receive calls

    const pathname =
      payload.consultationType === 'video'
        ? '/(patient)/video-consultation'
        : '/(patient)/phone-consultation'

    router.replace({
      pathname: pathname as any,
      params: {
        consultationId:  payload.consultationId,
        channelId:       payload.consultationId,
        doctorName:      payload.doctorName,
        doctorId:        payload.doctorId,
        doctorPhotoUrl:  payload.doctorPhotoUrl ?? '',
        // Flag so the consultation screen knows CallKeep already handled ringing
        fromCallkeep:    '1',
      },
    })
  }

  useEffect(() => {
    if (callkeepInitRef.current) return
    callkeepInitRef.current = true

    // 1. Initialise CallKeep (sets up ConnectionService / CallKit)
    callkeep.init()

    // 2. Wire the answer handler — fires when the patient or doctor taps
    //    Accept on the OS call screen (see navigateToConsultation's
    //    direction branch for which).
    callkeep.onAnswer((payload) => {
      logger.log('[CallKeep] Answered consultation:', payload.consultationId, 'direction:', payload.direction ?? 'patient')
      const expectedRole = payload.direction === 'doctor' ? 'doctor' : 'patient'
      if (isSignedIn && userRole === expectedRole) {
        navigateToConsultation(payload)
      } else {
        // Auth not ready yet — stash and navigate once signed in
        pendingAnswerRef.current = payload
      }
    })

    // 3. Wire the decline handler — fires when Decline is tapped on the OS
    //    call screen, or the ring times out unanswered.
    callkeep.onEnd(async (uuid, payload) => {
      logger.log('[CallKeep] Declined / timed out consultation:', uuid, 'direction:', payload?.direction ?? 'patient')

      // direction === 'doctor': this was a patient's on-demand request
      // ringing the doctor, not yet an established consultation the doctor
      // was "in". Declining/ignoring it here should behave exactly like
      // ignoring the old plain notification did — leave the row at
      // 'waiting_for_doctor' so it stays visible in the doctor's queue
      // (matches the "no auto-expire" behavior other doctor surfaces rely
      // on — see checkForWaitingRequest in (doctor)/(tabs)/home.tsx).
      // Writing 'missed' here would misuse the status the *patient*-missed-
      // a-ringing-call flow below relies on, which notifies the doctor
      // ("your patient missed the call") — exactly backwards for this case.
      if (payload?.direction === 'doctor') return

      try {
        const token = await getToken()
        if (!token) return
        // Mark the consultation as declined by the patient — the DB trigger
        // (on_consultation_change) fires the doctor notification off this
        // status change, so no separate client-side notification call is needed.
        await getAuthClient(token)
          .from('consultations')
          .update({ status: 'missed' })
          .eq('id', uuid)
          .in('status', ['accepted', 'waiting_for_doctor'])
      } catch (e) {
        logger.warn('[CallKeep] Decline handler error:', e)
      }
    })

    // 4. iOS: register for VoIP push notification events (foreground + app-killed recovery)
    //    When the app was killed and PushKit woke it, the 'notification' event fires
    //    before any React component is mounted — before Clerk auth resolves, so
    //    lib/voipPush.ts's own listener (wired from usePushNotifications, which needs
    //    a loaded Clerk user) isn't registered yet. This is the only listener present
    //    for that case, so it must run the SAME staleness guard voipPush.ts's foreground/
    //    background listener uses (handleIncomingCallData) — calling
    //    callkeep.displayIncomingCall() here directly, with no freshness check, is
    //    exactly what let a stale/redelivered/already-resolved VoIP push raise a ghost
    //    CallKit screen (unknown doctor, missing avatar, phantom auto-decline countdown)
    //    on a cold start. displayIncomingCall() itself dedupes same-uuid calls within a
    //    short window, so it's safe to call unconditionally here even if voipPush.ts's
    //    listener also ends up handling the same push once its own listener registers.
    if (Platform.OS === 'ios' && RNVoipPush) {
      RNVoipPush.addEventListener('notification', (notification: any) => {
        logger.log('[VoIP] Foreground/recovery VoIP push received')
        const data = notification?.getData?.() ?? notification ?? {}
        if (data.callType !== 'incoming_call') return
        // Navigation is handled by callkeep.onAnswer below when the user
        // actually answers — mirrors registerCallTokens' no-op onIncoming in
        // hooks/usePushNotifications.ts. This call site only needs the
        // display-call + staleness-guard side effects of handleIncomingCallData.
        handleIncomingCallData(data, () => {})
      })

      // Call RNVoipPush.registerVoipToken() for cases where the auth isn't
      // ready during the voipPush.ts register phase — safe to call multiple times.
      try { RNVoipPush.registerVoipToken() } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Navigate once auth is ready if the patient/doctor answered while we were loading
  useEffect(() => {
    if (!isSignedIn) return
    const pending = pendingAnswerRef.current
    if (!pending) return
    const expectedRole = pending.direction === 'doctor' ? 'doctor' : 'patient'
    if (userRole !== expectedRole) return
    pendingAnswerRef.current = null
    navigateToConsultation(pending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole])

  // ── Active consultation recovery ──────────────────────────────────────────
  const recoveredRef = useRef(false)
  const { setActive, active: activeConsultation } = useActiveConsultationStore()
  const bootSegments = useSegments()
  const isOnConsultationScreenAtBoot = bootSegments.some(seg =>
    CONSULTATION_SEGMENTS.some(c => seg.includes(c))
  )

  const segments = useSegments()
  const isOnConsultationScreen = segments.some(seg =>
    CONSULTATION_SEGMENTS.some(c => seg.includes(c))
  )
  const isOnWaitingRoomScreen = segments.some(seg => seg.includes('waiting-room'))

  // Read fresh inside recover() (called from an AppState listener that
  // outlives any single render) without forcing the effect below to tear
  // down and rebuild its listener on every navigation.
  const isOnConsultationScreenRef = useRef(isOnConsultationScreen)
  useEffect(() => { isOnConsultationScreenRef.current = isOnConsultationScreen }, [isOnConsultationScreen])

  useEffect(() => {
    if (!isSignedIn || userRole !== 'patient') return

    const recover = async () => {
      if (recoveredRef.current) return
      try {
        const token = await getToken()
        if (!token) return
        // completed/declined are terminal, not ongoing — only recover into them
        // within a short window of the resolution (the "app was closed/backgrounded
        // while it wrapped up, patient just reopened" case the spec calls out), not
        // forever, or every future app launch would keep bouncing the patient back
        // into an old summary/decline screen instead of wherever they navigated
        // afterward.
        const resolvedSince = new Date(Date.now() - 30 * 60 * 1000).toISOString()
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, status, started_at, doctor_id, doctor_profiles!doctor_id(users!inner(full_name, profile_photo_url))')
          .or(`status.in.(accepted,in_progress),and(status.in.(completed,declined),updated_at.gte.${resolvedSince})`)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!data) {
          // A consultation the store still thinks is active may have been
          // completed by the doctor while this device was closed/backgrounded.
          // Never leave the patient parked on a stale banner/screen — if it's
          // now completed, send them straight to its summary instead of just
          // silently clearing the store (which would drop them on whatever
          // screen the app happens to boot into).
          const stale = useActiveConsultationStore.getState().active
          if (stale?.role === 'patient') {
            setActive(null)
            if (!isOnConsultationScreenAtBoot) {
              try {
                const { data: staleRow } = await getAuthClient(token)
                  .from('consultations')
                  .select('status, doctor_id')
                  .eq('id', stale.consultationId)
                  .maybeSingle()
                if ((staleRow as any)?.status === 'completed') {
                  // A review already on file means the patient finished the
                  // post-call rating flow for this consultation — it's now
                  // historical (Appointments > Past only), never a recovery
                  // target. Without this check, a completed-but-already-rated
                  // consultation kept bouncing the patient back into
                  // consultation-summary (showing "already rated") forever,
                  // since this branch has no time window at all.
                  const { data: existingReview } = await getAuthClient(token)
                    .from('reviews')
                    .select('id')
                    .eq('consultation_id', stale.consultationId)
                    .maybeSingle()
                  if (!existingReview) {
                    router.replace({
                      pathname: '/(patient)/consultation-summary',
                      params: {
                        consultationId: stale.consultationId,
                        doctorId: (staleRow as any).doctor_id,
                        doctorName: stale.otherPersonName,
                        consultationType: stale.type,
                      },
                    } as any)
                  }
                }
              } catch {}
            }
          }
          return
        }

        if ((data as any).status === 'completed') {
          recoveredRef.current = true
          // This branch (unlike the `!data` one above) never went through
          // setActive(null) — the persisted "active" banner/timer/Resume chip
          // survived a completed consultation indefinitely whenever this
          // effect found the row here first (e.g. status flipped while the
          // app was backgrounded and the realtime self-heal below missed the
          // change). Clear it, scoped to this exact consultation so a
          // genuinely different in-progress call's banner is never touched.
          if (useActiveConsultationStore.getState().active?.consultationId === (data as any).id) {
            setActive(null)
          }
          // A review already on file (DB is the source of truth, never local
          // state) means the patient already finished the post-call rating
          // flow for this consultation — it's historical now (Appointments >
          // Past), not a recovery target. Without this check, this effect
          // re-running on every AppState foreground kept force-navigating an
          // already-rated patient back into consultation-summary, which then
          // had to tell them "you have already rated this consultation".
          const { data: existingReview } = await getAuthClient(token)
            .from('reviews')
            .select('id')
            .eq('consultation_id', (data as any).id)
            .maybeSingle()
          if (!existingReview && !isOnConsultationScreenAtBoot) {
            router.replace({
              pathname: '/(patient)/consultation-summary',
              params: {
                consultationId: (data as any).id,
                doctorId: (data as any).doctor_id ?? '',
                doctorName: (data as any).doctor_profiles?.users?.full_name ?? 'Doctor',
                consultationType: (data as any).type ?? 'chat',
              },
            } as any)
          }
          return
        }

        if ((data as any).status === 'declined') {
          recoveredRef.current = true
          if (useActiveConsultationStore.getState().active?.consultationId === (data as any).id) {
            setActive(null)
          }
          // Rendered in-place by the waiting-room screen itself
          // (credit-preserved messaging) — there is no separate screen for it.
          if (!isOnConsultationScreenAtBoot) {
            router.replace({
              pathname: '/(patient)/waiting-room',
              params: { consultationId: (data as any).id },
            } as any)
          }
          return
        }
        recoveredRef.current = true

        const consultationId: string = (data as any).id
        const type: string           = (data as any).type ?? 'chat'
        const status: string         = (data as any).status
        const startedAt: string | null = (data as any).started_at
        const doctorId: string       = (data as any).doctor_id ?? ''
        const doctorName: string     = (data as any).doctor_profiles?.users?.full_name ?? 'Doctor'
        const doctorPhotoUrl: string | null = (data as any).doctor_profiles?.users?.profile_photo_url ?? null

        // 'accepted' means the patient has not yet reached a steady in-call
        // state — they may still be on the Chapa receipt, the Payment
        // Verified screen, the waiting room, or reopening a backgrounded app
        // after the doctor accepted while they were away. The DB status is
        // the single source of truth for navigation, never the screen the
        // patient happens to be on, so sweep them straight into the call
        // instead of leaving them stuck behind a tap-to-"Resume" banner.
        // Once a call reaches 'in_progress' the patient has already been
        // inside it at least once, so a deliberate step-away from there is
        // left to the banner below rather than force-navigating on every
        // foreground.
        if (status === 'accepted' && !isOnConsultationScreenRef.current) {
          const pathname =
            type === 'video' ? '/(patient)/video-consultation' :
            type === 'phone' ? '/(patient)/phone-consultation' :
            '/(patient)/chat-consultation'
          router.replace({
            pathname: pathname as any,
            params: { consultationId, channelId: consultationId, doctorId, doctorName, doctorPhotoUrl: doctorPhotoUrl ?? '' },
          })
        }

        // Timer always derives from the real started_at, never a locally
        // frozen/carried-over counter — the RN JS timer that ticks the
        // banner's displaySeconds pauses while the app is backgrounded, so
        // reusing the stored value on every foreground/resume would under-
        // count real elapsed time instead of resyncing to the DB.
        setActive({
          consultationId,
          type: type as 'phone' | 'video' | 'chat',
          otherPersonName: doctorName,
          otherPersonPhotoUrl: doctorPhotoUrl,
          role: 'patient',
          elapsedSeconds: status === 'in_progress' && startedAt
            ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
            : 0,
          callStartedAtMs: status === 'in_progress' && startedAt ? new Date(startedAt).getTime() : null,
          status: 'active',
        })
      } catch {}
    }

    recover()

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        recoveredRef.current = false
      } else if (state === 'active') {
        recover()
      }
    })

    // Realtime-triggered: a patient sitting idle on a foregrounded screen
    // (Appointments, Home) when the doctor accepts is otherwise never pulled
    // into the consultation until they background/foreground the app —
    // mirrors the waiting-room-activation subscription just below. Without
    // this, "doctor accepts while patient watches Upcoming" left the patient
    // parked there indefinitely instead of being swept into the call.
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    if (clerkUser?.id) {
      (async () => {
        const token = await getToken()
        if (!token || cancelled) return
        const { data: me } = await getAuthClient(token)
          .from('users')
          .select('id')
          .eq('clerk_id', clerkUser.id)
          .maybeSingle()
        if (!me || cancelled) return

        channel = supabase
          .channel(`patient-consultation-recovery-${me.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `patient_id=eq.${me.id}` },
            (payload) => {
              const status = (payload.new as { status?: string })?.status
              if (status === 'accepted' || status === 'completed' || status === 'declined') recover()
            },
          )
          .subscribe()
      })()
    }

    return () => { cancelled = true; sub.remove(); if (channel) supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole, clerkUser?.id])

  // ── Patient: waiting-room recovery ─────────────────────────────────────────
  // A paid consultation sitting in 'waiting_for_doctor' must survive the app
  // being closed and reopened — the DB is the source of truth, never a
  // client-side timer. Without this, closing the app while waiting orphaned
  // the request: relaunching landed on Home with no sign anything was
  // pending (AsyncStorage's PENDING_KEY in waiting-room.tsx was written but
  // never read back anywhere).
  const waitingRecoveredRef = useRef(false)
  useEffect(() => {
    // Must also skip while the patient is inside a live call screen — without
    // isOnConsultationScreen, foregrounding the app (switching apps, a
    // permission dialog, a notification banner) while a *different*,
    // stale/duplicate consultation is still sitting in 'waiting_for_doctor'
    // would yank the patient out of an active call and into the waiting
    // room, even though this consultation itself is unaffected. Mirrors the
    // doctor-recovery effect's already-correct guard just below.
    if (!isSignedIn || userRole !== 'patient' || isOnWaitingRoomScreen || isOnConsultationScreen) return

    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    const recoverWaiting = async () => {
      if (waitingRecoveredRef.current) return
      try {
        const token = await getToken()
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, doctor_id, doctor_profiles!doctor_id(users!inner(full_name, profile_photo_url))')
          .eq('status', 'waiting_for_doctor')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!data) return
        waitingRecoveredRef.current = true

        const consultationId: string = (data as any).id
        const type: string           = (data as any).type ?? 'chat'
        const doctorId: string       = (data as any).doctor_id
        const doctorName: string     = (data as any).doctor_profiles?.users?.full_name ?? 'Doctor'

        router.replace({
          pathname: '/(patient)/waiting-room' as any,
          params: { consultationId, doctorId, doctorName, consultationType: type },
        })
      } catch {}
    }

    recoverWaiting()

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        waitingRecoveredRef.current = false
      } else if (state === 'active') {
        recoverWaiting()
      }
    })

    // Realtime-triggered: a patient sitting idle on a foregrounded screen
    // (Home, Appointments) when the per-minute cron flips their scheduled
    // booking to 'waiting_for_doctor' is otherwise never pulled in until
    // they background/foreground the app. Subscribe directly so the
    // transition is silent and immediate, matching the on-demand flow's
    // realtime redirect in payment-return.tsx.
    if (clerkUser?.id) {
      (async () => {
        const token = await getToken()
        if (!token || cancelled) return
        const { data: me } = await getAuthClient(token)
          .from('users')
          .select('id')
          .eq('clerk_id', clerkUser.id)
          .maybeSingle()
        if (!me || cancelled) return

        channel = supabase
          .channel(`patient-waiting-room-activation-${me.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `patient_id=eq.${me.id}` },
            (payload) => {
              if ((payload.new as { status?: string })?.status === 'waiting_for_doctor') recoverWaiting()
            },
          )
          .subscribe()
      })()
    }

    return () => { cancelled = true; sub.remove(); if (channel) supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole, isOnWaitingRoomScreen, isOnConsultationScreen, clerkUser?.id])

  // ── Doctor: active consultation recovery ──────────────────────────────────
  const doctorFetchingRef = useRef(false)

  useEffect(() => {
    if (!isSignedIn || userRole !== 'doctor') return
    // Don't re-check while the doctor is already viewing a consultation screen.
    // Re-checking as soon as they leave means a stale/ended consultation clears
    // the banner immediately instead of leaving a dead "Resume" behind.
    if (isOnConsultationScreen) return

    const recoverDoctor = async () => {
      if (doctorFetchingRef.current) return
      doctorFetchingRef.current = true
      try {
        const token = await getToken()
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, status, started_at, users!consultations_patient_id_fkey(full_name, profile_photo_url)')
          .in('status', ['accepted', 'in_progress'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!data) {
          if (activeConsultation?.role === 'doctor') setActive(null)
          return
        }

        const consultationId: string = (data as any).id
        const type: string           = (data as any).type ?? 'chat'
        const status: string         = (data as any).status
        const startedAt: string | null = (data as any).started_at
        const patientName: string    = (data as any).users?.full_name ?? 'Patient'
        const patientPhotoUrl: string | null = (data as any).users?.profile_photo_url ?? null

        // See the matching comment in the patient recovery effect above —
        // always resync from the real started_at, never a carried-over local
        // counter.
        setActive({
          consultationId,
          type: type as 'phone' | 'video' | 'chat',
          otherPersonName: patientName,
          otherPersonPhotoUrl: patientPhotoUrl,
          role: 'doctor',
          elapsedSeconds: status === 'in_progress' && startedAt
            ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
            : 0,
          callStartedAtMs: status === 'in_progress' && startedAt ? new Date(startedAt).getTime() : null,
          status: 'active',
        })
      } catch {
      } finally {
        doctorFetchingRef.current = false
      }
    }

    recoverDoctor()

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') recoverDoctor()
    })
    return () => sub.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole, isOnConsultationScreen])

  // ── Ghost-consultation self-heal ───────────────────────────────────────────
  // The two recovery effects above only re-check the DB on mount / AppState
  // foreground transitions. If the other party ends the consultation while
  // this device stays in the foreground the whole time (e.g. browsing Home),
  // neither effect re-fires, so the persisted "active" banner + timer can
  // survive indefinitely. Subscribe directly to the one row we're showing so
  // a remote completion/cancellation clears the banner live, not just on the
  // next foreground transition.
  useEffect(() => {
    if (!activeConsultation?.consultationId) return
    const id = activeConsultation.consultationId
    const ch = supabase
      .channel(`active-consultation-guard-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${id}` },
        (payload) => {
          const status = (payload.new as { status?: string })?.status
          if (status && GHOST_TERMINAL_STATUSES.has(status)) setActive(null)
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConsultation?.consultationId])

  // ── In-app notification when a new Stream message arrives ─────────────────
  // Preference check: doctor and patient both expose a "Messages" toggle in
  // notification-settings.tsx (column `messages`), but nothing previously
  // read it before showing this local notification — turning it off had no
  // effect. Fetched once per session (re-fetched whenever userId changes,
  // i.e. on sign-in) rather than per-message; a change made mid-session
  // takes effect on next app launch, same tradeoff the settings screens
  // already accept for their debounced save.
  const messagesPrefEnabledRef = useRef(true)
  useEffect(() => {
    if (!userId) return
    supabase
      .from('notification_preferences')
      .select('messages')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        messagesPrefEnabledRef.current = (data as any)?.messages !== false
      })
  }, [userId])

  useEffect(() => {
    if (!isStreamConnected || !userId) return

    const sub = streamClient.on('message.new', (event) => {
      if (!event.message || event.message.user?.id === userId) return
      if (!messagesPrefEnabledRef.current) return

      const channelId = event.channel_id ?? ''

      // Foregrounded AND already looking at this exact conversation: the chat
      // screen updates live via its own Stream subscription, so a
      // notification here would be redundant noise. This WebSocket-driven
      // path only ever fires while foregrounded anyway (the socket dies in
      // background), so backgrounded/terminated delivery depends entirely on
      // Stream's own server-side push (registered via streamClient.addDevice
      // in usePushNotifications.ts) — this handler is purely the "in-app
      // notification while elsewhere in the app" case.
      if (channelId && channelId === useActiveChatStore.getState().activeChannelId) return

      const senderName = event.message.user?.name ?? 'New message'
      const text = event.message.text ?? ''
      const hasAttachment = (event.message.attachments?.length ?? 0) > 0
      const preview = text
        ? (text.length > 80 ? `${text.slice(0, 77)}...` : text)
        : hasAttachment ? 'Sent an attachment' : 'New message'

      if (Platform.OS !== 'web') {
        Notifications.scheduleNotificationAsync({
          content: {
            title: senderName,
            body: preview,
            sound: 'default',
            data: { screen: 'chat', channelId },
            ...(Platform.OS === 'android' ? { channelId: 'messages' } : {}),
          },
          trigger: null,
        })
      }
    })

    return () => sub.unsubscribe()
  }, [isStreamConnected, userId])

  // ── Handle notification tap — navigate to correct screen ─────────────────
  // Marks the exact notifications-table row read (via data.notificationId,
  // threaded through by the edge functions) and recomputes the real OS
  // badge from the unread count, instead of blanket-zeroing it — a tap on
  // one notification must not silently clear unrelated unread ones.
  useEffect(() => {
    const handleResponse = (data: Record<string, string>) => {
      navigateForNotification(router, userRole, data, userRole === 'doctor' ? currentDoctorRouteRef.current : undefined, getNavRootState())
      if (data?.notificationId) {
        markNotificationRead(supabase, data.notificationId).then(() => refreshBadge(supabase, userId))
      } else {
        refreshBadge(supabase, userId)
      }
    }

    if (Platform.OS === 'web') return

    const tapSub = Notifications.addNotificationResponseReceivedListener(response => {
      handleResponse(response.notification.request.content.data as Record<string, string>)
      Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {})
    })

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return
      handleResponse(response.notification.request.content.data as Record<string, string>)
      Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {})
      // Without this, iOS keeps returning the same cold-start response on every
      // subsequent launch, re-navigating to (and re-"opening") a notification
      // the user already acted on.
      Notifications.clearLastNotificationResponseAsync().catch(() => {})
    })

    return () => tapSub.remove()
  }, [userRole, userId])

  // Recompute the real badge on every foreground — catches notifications
  // read on another device, or ones auto-cleared by navigating directly to
  // their destination screen (see lib/notificationCenter.ts call sites).
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return
    refreshBadge(supabase, userId)
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refreshBadge(supabase, userId)
    })
    return () => sub.remove()
  }, [userId])

  return null
}

// ─── Version gate ─────────────────────────────────────────────────────────────

function VersionGate({ children }: { children: React.ReactNode }) {
  const { status, updateMessage, storeUrl, latestVersion } = useVersionCheck()
  if (status === 'update_required') {
    return <ForceUpdateScreen message={updateMessage} storeUrl={storeUrl} latestVersion={latestVersion} />
  }
  return <>{children}</>
}

function SplashHider() {
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}) }, [])
  return null
}

// Clerk needs a live network round-trip to resolve its environment/client on
// a cold start — with no cached session and no connectivity, `<ClerkLoading>`
// would otherwise spin forever. After a grace period (avoids flashing this on
// a merely-slow connection), check NetInfo directly and swap the spinner for
// a full-screen "Connection unavailable" gate instead of leaving the user
// staring at it indefinitely.
const CLERK_OFFLINE_GATE_DELAY_MS = 4000

function ClerkLoadingGate({ onRetry }: { onRetry: () => void }) {
  const [showOfflineGate, setShowOfflineGate] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      NetInfo.fetch().then((state) => {
        if (cancelled) return
        const online = (state.isConnected ?? true) && (state.isInternetReachable ?? true)
        if (!online) setShowOfflineGate(true)
      })
    }, CLERK_OFFLINE_GATE_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  if (showOfflineGate) {
    return <OfflineStartScreen onRetry={() => { setShowOfflineGate(false); onRetry() }} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#070E27', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#00BFA5" />
    </View>
  )
}

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  })
  // Bumped on Retry to force ClerkProvider to remount and re-attempt its
  // initial network fetch, rather than leaving it stuck on whatever request
  // failed at cold start — the app itself is never restarted.
  const [clerkKey, setClerkKey] = useState(0)

  if (!fontsLoaded && !fontError) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider key={clerkKey} publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoading>
          <ClerkLoadingGate onRetry={() => setClerkKey((k) => k + 1)} />
        </ClerkLoading>
        <ClerkLoaded>
          <SplashHider />
          <VersionGate>
            <OverlayProvider>
              <AppInitializer />
              <Stack screenOptions={{ headerShown: false }} />
              <NetworkBanner />
              <ActiveCallBanner />
            </OverlayProvider>
          </VersionGate>
        </ClerkLoaded>
      </ClerkProvider>
    </GestureHandlerRootView>
  )
}
