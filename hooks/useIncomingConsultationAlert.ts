import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, Vibration } from 'react-native'
import { useAuth } from '@clerk/clerk-expo'
import { useRootNavigationState, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'

import { getAuthClient, supabase } from '@/lib/supabase'
import { ghostDebug } from '@/lib/logger'
import { navigateFamilyRoute } from '@/lib/notificationNav'
import { callkeep } from '@/lib/callkeep'
import { useActiveIncomingRequestStore } from '@/store/activeIncomingRequestStore'
import { useDoctorQueueStore, type QueuedRequest } from '@/store/doctorQueueStore'

// Lazy-loaded so Expo Go / web (no native module registered) don't crash.
let notifeeMod: any = null
let AndroidImportance: any = null
if (Platform.OS === 'android') {
  try {
    const lib = require('@notifee/react-native')
    notifeeMod = lib.default
    AndroidImportance = lib.AndroidImportance
  } catch {
    // development build required — falls back to expo-notifications below
  }
}

// A new incoming request must ring continuously (sound + vibration) until
// the doctor accepts, declines, or it expires — matching the CallKeep
// native ring already used for phone/video requests. Android: an `ongoing`,
// `loopSound` Notifee notification (Android's FLAG_INSISTENT under the
// hood) repeats the channel's sound + vibration for as long as the
// notification stays visible, which is the same mechanism a real
// incoming-call notification would use, without requiring a foreground
// service. iOS falls back to a single scheduled local notification (no
// insistent-repeat equivalent without a Critical Alerts entitlement) plus
// continuous device vibration.
const RING_VIBRATION_PATTERN = [0, 700, 400, 700, 400, 700]
const RING_VIBRATION_FALLBACK_MS = 25_000

function ringIncomingRequest(title: string, body: string, consultationId: string) {
  Vibration.vibrate(RING_VIBRATION_PATTERN, true)

  if (Platform.OS === 'android' && notifeeMod) {
    notifeeMod
      .displayNotification({
        // Same id/tag the FCM-triggered push already displays this under
        // (see index.js's background handler and lib/voipPush.ts's
        // foreground handler) so this client-side fallback collapses into
        // the same tray entry instead of stacking a second one.
        id: `incoming-request-${consultationId}`,
        title,
        body,
        data: { screen: 'incoming_request', consultationId },
        android: {
          channelId: 'incoming_requests_v2',
          importance: AndroidImportance?.MAX ?? 4,
          category: 'call',
          fullScreenAction: { id: 'default', launchActivity: 'default' },
          pressAction: { id: 'default', launchActivity: 'default' },
          autoCancel: true,
          ongoing: true,
          loopSound: true,
          tag: `incoming-request-${consultationId}`,
        },
      })
      .catch(() => {})
    return
  }

  // iOS / no Notifee available — single ring, continuous vibration above
  // covers the "keep alerting" requirement as best this platform allows.
  Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: { screen: 'incoming_request', consultationId },
    },
    trigger: null,
  }).catch(() => {})
  setTimeout(() => Vibration.cancel(), RING_VIBRATION_FALLBACK_MS)
}

// Stops whichever ring mechanism above is currently active for this
// consultation — called once the doctor accepts/declines (from
// incoming-request.tsx) or once it drops off the waiting queue (resolved
// from elsewhere: another device, patient cancel, expiry).
export function stopIncomingRequestRing(consultationId: string) {
  Vibration.cancel()
  if (Platform.OS === 'android' && notifeeMod) {
    notifeeMod.cancelNotification(`incoming-request-${consultationId}`).catch(() => {})
  }
}

/**
 * Doctor-only. Detects a waiting_for_doctor/paid consultation and rings +
 * navigates to the full-screen incoming-request UI — regardless of which
 * screen, tab, or modal the doctor currently has open.
 *
 * Mounted once in app/(doctor)/_layout.tsx (the Stack that wraps every
 * doctor screen, tab or otherwise, for the doctor's entire session) instead
 * of app/(doctor)/(tabs)/home.tsx, where this used to live. Tying it to
 * Home meant the doctor only got alerted while Home itself happened to be
 * mounted — true immediately after login (it's the first tab) but not
 * guaranteed for the rest of the session (a tab can be recycled under
 * memory pressure, and any future deep-link that lands the doctor on a
 * different tab first would never mount Home at all). Root-Stack layouts
 * don't get recycled the way tab screens can, so this is the one place a
 * "ring the doctor no matter where they are" listener actually belongs —
 * mirrors useActiveConsultationRecovery, which already runs from this same
 * layout for exactly this reason.
 */
export function useIncomingConsultationAlert(enabled: boolean) {
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const { getToken, userId: clerkUserId } = useAuth()

  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const shownConsultationIds = useRef(new Set<string>())
  const prevQueueIdsRef = useRef(new Set<string>())

  const checkForWaitingRequest = async (profileId: string, token: string) => {
    const client = getAuthClient(token)

    const { data: busy } = await client.rpc('is_doctor_busy', { p_doctor_id: profileId })

    const { data: waitingList } = await client
      .from('consultations')
      .select('id, type, patient_id, patient_amount, waiting_started_at')
      .eq('doctor_id', profileId)
      .eq('status', 'waiting_for_doctor')
      .eq('payment_status', 'paid')
      .order('waiting_started_at', { ascending: true })

    const list = waitingList ?? []
    ghostDebug('[incoming-consultation] checkForWaitingRequest (global)', {
      profileId, busy, waitingIds: list.map((w) => w.id),
    })

    const nextIds = new Set(list.map((w) => w.id))
    // A previously-waiting request just disappeared (accepted/declined/
    // cancelled/expired, possibly from another device) — stop ringing for
    // it immediately rather than leaving a stale notification looping.
    for (const staleId of prevQueueIdsRef.current) {
      if (!nextIds.has(staleId)) stopIncomingRequestRing(staleId)
    }
    prevQueueIdsRef.current = nextIds

    if (list.length === 0) {
      useDoctorQueueStore.getState().setQueueList([])
    } else {
      const { data: queuePatients } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', list.map((w) => w.patient_id))
      const nameById = new Map((queuePatients ?? []).map((p) => [p.id, p.full_name]))
      const queue: QueuedRequest[] = list.map((w) => ({
        id: w.id,
        patientId: w.patient_id,
        patientName: nameById.get(w.patient_id) ?? 'Patient',
        waitingStartedAt: w.waiting_started_at ?? new Date().toISOString(),
      }))
      useDoctorQueueStore.getState().setQueueList(queue)
    }

    if (busy) return

    // Skip past requests already offered once — not just list[0]. A
    // waiting_for_doctor row never auto-expires (migration 062), so if the
    // oldest queued request was shown but never resolved, it stays list[0]
    // forever. Bailing out on list[0] alone would permanently hide every
    // other patient queued behind it.
    const waiting = list.find((w) => !shownConsultationIds.current.has(w.id))
    if (!waiting) return
    // Another surface (a push-notification tap, or the Consultations tab)
    // already has the single incoming-request full screen open for this
    // exact consultation — don't navigate there a second time.
    if (useActiveIncomingRequestStore.getState().shownRequestId === waiting.id) {
      ghostDebug('[incoming-consultation] skipped — already shown elsewhere', { consultationId: waiting.id })
      return
    }
    // Phone/video requests already ring through the native ConnectionService
    // incoming-call UI as soon as the FCM push arrives — usually well before
    // this poll cycle would ever run. Skip the vibrate+notification+navigate
    // fallback below while that's actively ringing.
    if (callkeep.isCallActive(waiting.id)) return
    // The root layout may not have mounted its navigator yet — pushing
    // before then throws and silently drops the navigation. Don't mark it
    // shown in that case either, so the next poll cycle retries.
    if (!rootNavigationState?.key) return
    shownConsultationIds.current.add(waiting.id)

    const { data: patientData } = await supabase
      .from('users')
      .select('full_name, clerk_id, profile_photo_url')
      .eq('id', waiting.patient_id)
      .single()

    ringIncomingRequest(
      'New consultation request',
      `${(patientData as any)?.full_name ?? 'A patient'} is waiting for you`,
      waiting.id,
    )
    ghostDebug('[incoming-consultation] navigating to incoming-request (global)', { consultationId: waiting.id })

    navigateFamilyRoute(
      router,
      rootNavigationState,
      '/(doctor)/incoming-request',
      {
        patientName:      (patientData as any)?.full_name ?? 'Patient',
        patientId:        waiting.patient_id ?? '',
        patientClerkId:   (patientData as any)?.clerk_id ?? '',
        patientPhotoUrl:  (patientData as any)?.profile_photo_url ?? '',
        consultationType: waiting.type ?? 'chat',
        consultationId:   waiting.id,
      },
      'push',
    )
  }

  // ── Resolve this doctor's profile id once, independent of any screen's
  // own dashboard-load lifecycle ─────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !clerkUserId) {
      setDoctorProfileId(null)
      return
    }
    let cancelled = false

    const resolve = async () => {
      const token = await getToken()
      if (!token || cancelled) return
      const client = getAuthClient(token)
      const { data: me } = await client.from('users').select('id').eq('clerk_id', clerkUserId).maybeSingle()
      if (!me || cancelled) return
      const { data: profile } = await client
        .from('doctor_profiles').select('id').eq('user_id', (me as any).id).maybeSingle()
      if (!cancelled && profile) setDoctorProfileId((profile as any).id)
    }
    resolve()
    return () => { cancelled = true }
  }, [enabled, clerkUserId])

  // ── Realtime + poll fallback — the sole source of truth for "is there an
  // incoming request the doctor hasn't been alerted to yet", now
  // independent of which screen is on top.
  useEffect(() => {
    if (!doctorProfileId) return

    const topic = `doctor-incoming-alert-${doctorProfileId}`
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
    if (stale) supabase.removeChannel(stale)

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${doctorProfileId}` },
        async () => {
          const token = await getToken()
          if (!token) return
          await checkForWaitingRequest(doctorProfileId, token)
        },
      )
      .subscribe()

    // Initial check — catches a request already waiting before this hook
    // ever mounted (Realtime only catches future updates).
    getToken().then((token) => { if (token) checkForWaitingRequest(doctorProfileId, token) })

    // Poll fallback — Realtime sockets get suspended while the OS
    // backgrounds the app; this, plus the AppState resync below, catches
    // whatever a suspended socket missed.
    const poll = setInterval(() => {
      getToken().then((token) => { if (token) checkForWaitingRequest(doctorProfileId, token) })
    }, 10_000)

    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorProfileId])

  // Re-check the instant the app returns to the foreground — a request that
  // arrived while backgrounded (Realtime suspended) must be caught
  // immediately, not on the next 10s poll tick.
  useEffect(() => {
    if (!doctorProfileId) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then((token) => { if (token) checkForWaitingRequest(doctorProfileId, token) })
    })
    return () => sub.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorProfileId])
}
