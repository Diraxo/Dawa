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
import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from '@clerk/clerk-expo'
import * as Notifications from 'expo-notifications'
import { SplashScreen, Stack, useRouter, useSegments } from 'expo-router'
import { useEffect, useRef } from 'react'
import { ActivityIndicator, AppState, AppStateStatus, Platform, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useStreamConnection } from '@/hooks/useStreamConnection'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { streamClient } from '@/lib/stream'
import { getAuthClient, setClerkTokenGetter, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { useActiveChatStore } from '@/store/activeChatStore'
import ForceUpdateScreen from '@/components/shared/ForceUpdateScreen'
import NetworkBanner from '@/components/ui/NetworkBanner'
import { callkeep, type IncomingCallPayload } from '@/lib/callkeep'
import { registerCallTokens } from '@/lib/voipPush'
import { logger } from '@/lib/logger'

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

  // Inject Clerk's getToken into the Supabase client
  useEffect(() => {
    if (isSignedIn) {
      setClerkTokenGetter(() => getToken())
    } else {
      setClerkTokenGetter(null)
    }
  }, [isSignedIn, getToken])

  useStreamConnection()

  // Restore saved language preference on every cold start
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((code) => {
      if (code && code !== i18n.language) i18n.changeLanguage(code)
    })
  }, [])

  usePushNotifications()

  // ── CallKeep initialisation + incoming-call wiring ───────────────────────
  // Must be inside a component so we have access to `router`.
  const callkeepInitRef = useRef(false)
  const pendingAnswerRef = useRef<IncomingCallPayload | null>(null)

  // Navigate patient to the consultation when they answer via OS call screen
  const navigateToConsultation = (payload: IncomingCallPayload) => {
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

    // 2. Wire the answer handler — fires when patient taps Accept on OS screen
    callkeep.onAnswer((payload) => {
      logger.log('[CallKeep] Patient answered consultation:', payload.consultationId)
      if (isSignedIn && userRole === 'patient') {
        navigateToConsultation(payload)
      } else {
        // Auth not ready yet — stash and navigate once signed in
        pendingAnswerRef.current = payload
      }
    })

    // 3. Wire the decline handler — fires when patient taps Decline on OS screen
    callkeep.onEnd(async (uuid) => {
      logger.log('[CallKeep] Patient declined / timed out consultation:', uuid)
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
    //    before any React component is mounted. We handle it here.
    if (Platform.OS === 'ios' && RNVoipPush) {
      RNVoipPush.addEventListener('notification', (notification: any) => {
        logger.log('[VoIP] Foreground/recovery VoIP push received')
        const data = notification?.getData?.() ?? notification ?? {}
        if (data.callType !== 'incoming_call') return

        const payload: IncomingCallPayload = {
          uuid:             data.uuid             || data.consultationId || '',
          consultationId:   data.consultationId   || '',
          doctorName:       data.doctorName       || 'Doctor',
          doctorSpecialty:  data.doctorSpecialty  || undefined,
          doctorPhotoUrl:   data.doctorPhotoUrl   || undefined,
          doctorId:         data.doctorId         || '',
          doctorClerkId:    data.doctorClerkId    || '',
          consultationType: (data.consultationType === 'video' ? 'video' : 'phone') as 'phone' | 'video',
          agoraChannel:     data.agoraChannel     || data.consultationId || '',
          patientClerkId:   data.patientClerkId   || undefined,
        }

        if (!payload.uuid || !payload.consultationId) return

        // Display CallKit UI (if not already shown by voipPush.ts)
        if (!callkeep.isCallActive(payload.uuid)) {
          callkeep.displayIncomingCall(payload)
        }
      })

      // Call RNVoipPush.registerVoipToken() for cases where the auth isn't
      // ready during the voipPush.ts register phase — safe to call multiple times.
      try { RNVoipPush.registerVoipToken() } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Navigate once auth is ready if the patient answered while we were loading
  useEffect(() => {
    if (!isSignedIn || userRole !== 'patient') return
    const pending = pendingAnswerRef.current
    if (!pending) return
    pendingAnswerRef.current = null
    navigateToConsultation(pending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole])

  // ── Active consultation recovery ──────────────────────────────────────────
  const recoveredRef = useRef(false)
  const { setActive, active: activeConsultation } = useActiveConsultationStore()

  useEffect(() => {
    if (!isSignedIn || userRole !== 'patient') return

    const recover = async () => {
      if (recoveredRef.current) return
      try {
        const token = await getToken()
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('id, type, doctor_profiles!doctor_id(users!inner(full_name))')
          .in('status', ['accepted', 'in_progress'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!data) {
          if (activeConsultation?.role === 'patient') setActive(null)
          return
        }
        recoveredRef.current = true

        const consultationId: string = (data as any).id
        const type: string           = (data as any).type ?? 'chat'
        const doctorName: string     = (data as any).doctor_profiles?.users?.full_name ?? 'Doctor'

        setActive({
          consultationId,
          type: type as 'phone' | 'video' | 'chat',
          otherPersonName: doctorName,
          role: 'patient',
          elapsedSeconds: activeConsultation?.consultationId === consultationId
            ? (activeConsultation?.elapsedSeconds ?? 0)
            : 0,
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
    return () => sub.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userRole])

  // ── Doctor: active consultation recovery ──────────────────────────────────
  const segments = useSegments()
  const isOnConsultationScreen = segments.some(seg =>
    CONSULTATION_SEGMENTS.some(c => seg.includes(c))
  )
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
          .select('id, type, users!consultations_patient_id_fkey(full_name)')
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
        const patientName: string    = (data as any).users?.full_name ?? 'Patient'

        setActive({
          consultationId,
          type: type as 'phone' | 'video' | 'chat',
          otherPersonName: patientName,
          role: 'doctor',
          elapsedSeconds: activeConsultation?.consultationId === consultationId
            ? (activeConsultation?.elapsedSeconds ?? 0)
            : 0,
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
  useEffect(() => {
    if (!isStreamConnected || !userId) return

    const sub = streamClient.on('message.new', (event) => {
      if (!event.message || event.message.user?.id === userId) return

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
  useEffect(() => {
    const navigate = (data: Record<string, string>) => {
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
              router.push({ pathname: '/(doctor)/chat-consultation', params: { channelId } })
            } else {
              router.push({ pathname: '/(patient)/chat-consultation', params: { channelId } })
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
            const pathname =
              type === 'video'
                ? '/(patient)/video-consultation'
                : type === 'phone'
                ? '/(patient)/phone-consultation'
                : '/(patient)/chat-consultation'
            router.replace({
              pathname,
              params: {
                consultationId,
                channelId: consultationId,
                doctorName:    data.doctorName ?? 'Doctor',
                doctorId:      data.doctorId   ?? '',
                doctorPhotoUrl: data.doctorPhotoUrl ?? '',
                fromCallkeep:  '1',
              },
            })
          } else {
            router.replace('/(patient)/(tabs)/appointments')
          }
          break
        }

        case 'waiting-room':
        case 'waiting':
          if (consultationId) {
            router.push({
              pathname: '/(patient)/waiting-room',
              params: {
                consultationId,
                consultationType: consultationType ?? 'chat',
                doctorName: data.doctorName ?? 'Doctor',
                doctorId:   data.doctorId   ?? '',
              },
            })
          } else {
            router.push('/(patient)/(tabs)/appointments')
          }
          break

        case 'incoming_request':
          if (consultationId) {
            router.push({
              pathname: '/(doctor)/incoming-request',
              params: {
                consultationId,
                consultationType: consultationType ?? 'chat',
                patientName:      data.patientName    ?? 'Patient',
                patientId:        data.patientId      ?? '',
                patientClerkId:   data.patientClerkId ?? '',
                waitingStartedAt: data.waitingStartedAt ?? '',
              },
            })
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
          router.push('/(doctor)/(tabs)/consultations')
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
          if (userRole === 'doctor') {
            router.push('/(doctor)/(tabs)/profile')
          } else {
            router.push('/(patient)/(tabs)/profile')
          }
          break

        default:
          break
      }
    }

    if (Platform.OS === 'web') return

    const tapSub = Notifications.addNotificationResponseReceivedListener(response => {
      navigate(response.notification.request.content.data as Record<string, string>)
    })

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return
      navigate(response.notification.request.content.data as Record<string, string>)
    })

    return () => tapSub.remove()
  }, [userRole])

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

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  })

  if (!fontsLoaded && !fontError) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoading>
          <View style={{ flex: 1, backgroundColor: '#070E27', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#00BFA5" />
          </View>
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
