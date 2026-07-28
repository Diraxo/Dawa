import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRootNavigationState, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  Vibration,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppointmentDetailsSheet, type AppointmentDetails } from '@/components/doctor/AppointmentDetailsSheet'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorOnlineToggle } from '@/hooks/useDoctorOnlineToggle'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { callkeep } from '@/lib/callkeep'
import { ghostDebug } from '@/lib/logger'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { ethiopiaTodayRange, SLOT_DURATION_MINS } from '@/lib/slotGeneration'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { useNotificationCenter } from '@/hooks/useNotificationCenter'
import { navigateFamilyRoute } from '@/lib/notificationNav'
import { useActiveIncomingRequestStore } from '@/store/activeIncomingRequestStore'
import { useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

const CONSULTATION_ICONS: Record<'chat' | 'phone' | 'video', keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam',
}

// A new incoming request was previously only ever surfaced visually (the
// full-screen incoming-request modal) — nothing alerted a doctor whose eyes
// weren't already on the screen, unlike the web overlay's audible chime.
// Vibration.vibrate's `repeat` flag rings continuously until cancelled or
// the pattern is superseded, matching a phone-call-style alert; the local
// notification (through the 'incoming_requests_v2' Android channel, already
// configured with sound: 'default' — see hooks/usePushNotifications.ts)
// plays the actual ringtone-equivalent sound and is what a silenced device
// automatically downgrades to vibrate-only for, so a single call here
// correctly handles both "normal mode" and "silent mode" per the OS's own
// ringer-mode contract instead of this code trying to detect ringer mode
// itself (not reliably possible from JS on either platform).
const RING_VIBRATION_PATTERN = [0, 700, 400, 700, 400, 700]
const RING_DURATION_MS = 25_000

function ringIncomingRequest(title: string, body: string, consultationId: string) {
  Vibration.vibrate(RING_VIBRATION_PATTERN, true)
  setTimeout(() => Vibration.cancel(), RING_DURATION_MS)
  Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: { screen: 'incoming_request', consultationId },
      ...(Platform.OS === 'android' ? { channelId: 'incoming_requests_v2' } : {}),
    },
    trigger: null,
  }).catch(() => {})
}

interface ScheduleItem {
  id: string; patientId: string; patientName: string; patientPhotoUrl: string | null; time: string; scheduledAt: string; type: 'chat' | 'phone' | 'video'; status: string
}

// Statuses that mean "hasn't started yet" — once scheduledAt + the slot
// duration has passed with no activity, these are stale and should drop off
// Today's Schedule on their own (no manual refresh). A consultation that did
// start (accepted/in_progress/active) stays until its own status changes —
// a live call legitimately can run past its scheduled slot.
const NOT_YET_STARTED_STATUSES = new Set(['pending', 'waiting_for_doctor', 'scheduled'])

function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatWaiting(waitingStartedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(waitingStartedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export default function DoctorHomeScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const { user } = useUser()
  const { getToken } = useAuth()
  const { doctorStatus } = useDoctorStore()
  const { photoUrl: doctorPhotoUrl } = useOwnProfilePhoto()
  const [dbUserId, setDbUserId] = useState<string | null>(null)
  const { unreadCount } = useNotificationCenter(dbUserId)

  const rawFirstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? 'Doctor'
  const firstName = rawFirstName.replace(/^Dr\.?\s*/i, '').trim() || 'Doctor'

  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  // Today's Schedule must drop an expired, never-started item purely because
  // the clock ticked forward — no DB write, realtime event, or manual
  // refresh happens in that case, so nothing else re-renders this list.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const visibleSchedule = useMemo(() => schedule.filter((item) => {
    if (!NOT_YET_STARTED_STATUSES.has(item.status)) return true
    return new Date(item.scheduledAt).getTime() + SLOT_DURATION_MINS * 60_000 > nowTick
  }), [schedule, nowTick])
  const [detailsAppt, setDetailsAppt] = useState<AppointmentDetails | null>(null)
  const [stats, setStats] = useState({ totalConsultations: 0, completedToday: 0, earnings: 0, rating: 0 })
  const statsCacheKey = user?.id ? `doctor-dashboard-stats:${user.id}` : null
  const scheduleCacheKey = user?.id ? `doctor-dashboard-schedule:${user.id}` : null
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)
  const [dashboardLoadError, setDashboardLoadError] = useState<string | null>(null)
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const { isOnline, setIsOnline, toggling: togglingOnline, toggle: toggleOnline } = useDoctorOnlineToggle(doctorProfileId, { resyncOnForeground: true })
  const guardNav = useNavGuard()

  // Re-run whenever a consultation change comes in over Realtime (see the
  // subscription below) so a newly-paid scheduled booking, or one that's
  // been rescheduled in/out of today, shows up without a manual refresh.
  const loadTodaySchedule = async (client: ReturnType<typeof getAuthClient>) => {
    const { startIso, endIso } = ethiopiaTodayRange()

    const { data } = await client
      .from('consultations')
      .select(`id, patient_id, type, status, scheduled_at, patient:users!consultations_patient_id_fkey(full_name, profile_photo_url)`)
      .gte('scheduled_at', startIso)
      .lt('scheduled_at', endIso)
      .in('status', ['pending', 'active', 'waiting_for_doctor', 'accepted', 'in_progress', 'scheduled'])
      .order('scheduled_at', { ascending: true })

    if (data) {
      const next = data.map((r: any) => ({
        id: r.id,
        patientId: r.patient_id,
        patientName: (r.patient as any)?.full_name ?? 'Patient',
        patientPhotoUrl: (r.patient as any)?.profile_photo_url ?? null,
        time: new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        scheduledAt: r.scheduled_at,
        type: r.type ?? 'chat',
        status: r.status ?? 'scheduled',
      }))
      setSchedule(next)
      if (scheduleCacheKey) setCachedJson(scheduleCacheKey, next)
    }
  }

  // Mirror `schedule`/`queueList` so the users-table realtime handler (below)
  // can check "is this changed patient one of mine?" without a stale closure.
  const scheduleRef = useRef<ScheduleItem[]>([])
  useEffect(() => { scheduleRef.current = schedule }, [schedule])
  const queueListRef = useRef<{ id: string; patientId: string; patientName: string; waitingStartedAt: string }[]>([])

  // ── Load doctor profile ID + today's data ─────────────────────────────────
  // Wrapped in try/catch/finally with real loading/error state — previously
  // any failure here (network blip, a transient RLS/timing issue, `.single()`
  // throwing on 0 or 2+ rows) was swallowed silently: `me`/`profileRes.data`
  // being falsy just fell through with nothing set, leaving stats/schedule at
  // their zeroed initial state and the screen looking "stuck loading forever"
  // with no way to recover short of force-quitting the app. loadDashboard is
  // now retryable from the error state's Retry button.
  // Re-runs just the four "Today's Stats" cards' numbers (Total Consultations,
  // Completed Today, Rating, Total Earnings) — split out from loadDashboard so
  // the consultations-table realtime subscription below can keep these live
  // without also flashing the full-screen loading state on every event.
  const refreshStats = async (profileId: string, client: ReturnType<typeof getAuthClient>) => {
    const { startIso: todayStartIso } = ethiopiaTodayRange()
    const [profileRes, todayStatsRes, allEarningsRes] = await Promise.all([
      client.from('doctor_profiles').select('rating_average, total_consultations').eq('id', profileId).single(),
      client.from('consultations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('ended_at', todayStartIso),
      // Lifetime total, not today-scoped — matches the website's "Total
      // Earnings" card (carehub-web/app/doctor/page.tsx), which this
      // screen's stat is meant to mirror.
      client.from('consultations')
        .select('doctor_amount')
        .eq('status', 'completed'),
    ])
    if (!profileRes.data) return
    const p = profileRes.data as any
    const next = {
      totalConsultations: p.total_consultations ?? 0,
      completedToday: todayStatsRes.count ?? 0,
      earnings: (allEarningsRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.doctor_amount) || 0), 0),
      rating: Number(p.rating_average ?? 0),
    }
    setStats(next)
    if (statsCacheKey) setCachedJson(statsCacheKey, next)
  }

  const loadDashboard = async () => {
    if (!user?.id) return
    setDashboardLoadError(null)
    setIsLoadingDashboard(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const client = getAuthClient(token)

      // doctor_profiles SELECT RLS returns own row + every approved doctor's
      // row (for patient browsing), so this must be filtered to the caller's
      // own row or .single() throws once any other approved doctor exists.
      const { data: me, error: meError } = await client.from('users').select('id').eq('clerk_id', user?.id ?? '').single()
      if (meError || !me) throw meError ?? new Error('Could not load your account')
      setDbUserId((me as any).id)

      const { data: profile, error: profileError } = await client
        .from('doctor_profiles').select('id, user_id, is_online').eq('user_id', (me as any).id).single()
      if (profileError || !profile) throw profileError ?? new Error('Could not load your doctor profile')

      const p = profile as any
      const profileId: string = p.id
      setDoctorProfileId(profileId)
      setIsOnline(p.is_online ?? false)

      // Stats/today's-schedule are independent of each other (and of the
      // waiting-request check below) once profileId+token are known — no
      // reason to pay three sequential round trips for data that doesn't
      // depend on one another.
      await Promise.all([
        refreshStats(profileId, client),
        // Show incoming request modal for any consultation already waiting
        // when the doctor opens the screen (Realtime only catches future updates)
        checkForWaitingRequest(profileId, token),
        loadTodaySchedule(client),
      ])
    } catch (err: any) {
      setDashboardLoadError(err?.message ?? 'Could not load your dashboard')
    } finally {
      setIsLoadingDashboard(false)
    }
  }

  useEffect(() => { loadDashboard() }, [user?.id])

  // Hydrate last-known stats/schedule from disk immediately on mount so a
  // cold start shows real numbers instead of zeros/blank while the fetch
  // chain above (Clerk token -> users row -> doctor_profiles row -> stats)
  // is still in flight — loadDashboard() above reconciles with fresh data
  // as soon as it resolves, same cache-then-refresh pattern as
  // hooks/useOwnProfilePhoto.ts.
  useEffect(() => {
    if (!statsCacheKey || !scheduleCacheKey) return
    let cancelled = false
    getCachedJson<typeof stats>(statsCacheKey).then((cached) => {
      if (cached && !cancelled) setStats(cached)
    })
    getCachedJson<ScheduleItem[]>(scheduleCacheKey).then((cached) => {
      if (cached && !cancelled) setSchedule(cached)
    })
    return () => { cancelled = true }
  }, [statsCacheKey, scheduleCacheKey])

  // Ratings/total_consultations live-update — a new review or a completed
  // consultation updates doctor_profiles directly via DB trigger, which
  // never touches the `consultations` table, so the realtime subscription
  // below (scoped to `consultations`) can't catch it. Shares the same
  // channel useDoctorOnlineToggle already opened for is_online, via the
  // ref-counted manager, instead of opening a second subscription.
  useEffect(() => {
    if (!doctorProfileId) return
    return subscribeRealtime(
      `doctor_profiles:id=eq.${doctorProfileId}`,
      [{ event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${doctorProfileId}` }],
      (_event, payload) => {
        const updated = payload.new as any
        if (updated?.rating_average == null && updated?.total_consultations == null) return
        setStats((prev) => ({
          ...prev,
          rating: updated.rating_average != null ? Number(updated.rating_average) : prev.rating,
          totalConsultations: updated.total_consultations ?? prev.totalConsultations,
        }))
      },
    )
  }, [doctorProfileId])

  // ── Show incoming request only once payment is confirmed, and only while
  // the doctor is NOT already busy in another consultation ─────────────────
  // "Busy" (accepted/in_progress) is re-checked on every call — a scheduled
  // booking can activate mid-session, and the doctor must not be interrupted
  // until their current consultation ends (matches web's IncomingRequestOverlay).
  const shownConsultationIds = useRef(new Set<string>())

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
    ghostDebug('[incoming-consultation] checkForWaitingRequest', {
      profileId, busy, waitingIds: list.map((w) => w.id),
    })
    if (list.length === 0) {
      setQueueList([])
    } else {
      const { data: queuePatients } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', list.map((w) => w.patient_id))
      const nameById = new Map((queuePatients ?? []).map((p) => [p.id, p.full_name]))
      setQueueList(
        list.map((w) => ({
          id: w.id,
          patientId: w.patient_id,
          patientName: nameById.get(w.patient_id) ?? 'Patient',
          waitingStartedAt: w.waiting_started_at ?? new Date().toISOString(),
        }))
      )
    }

    if (busy) return

    // Skip past requests already offered once — not just list[0]. A
    // waiting_for_doctor row never auto-expires (migration 062), so if the
    // oldest queued request was shown but never resolved (doctor backed out
    // without accepting/declining, or a background accept/decline write
    // failed), it stays list[0] forever. Bailing out on list[0] alone would
    // permanently hide every other patient queued behind it.
    const waiting = list.find((w) => !shownConsultationIds.current.has(w.id))
    if (!waiting) return
    // Another surface (a push-notification tap, or the Consultations tab)
    // already has the single incoming-request full screen open for this
    // exact consultation — don't navigate there a second time. This is the
    // single source of truth check: see store/activeIncomingRequestStore.ts.
    if (useActiveIncomingRequestStore.getState().shownRequestId === waiting.id) {
      ghostDebug('[incoming-consultation] skipped — already shown elsewhere', { consultationId: waiting.id })
      return
    }
    // Phone/video requests already ring through the native ConnectionService
    // incoming-call UI (see lib/callkeep.ts + the 'new_request' case in
    // supabase/functions/handle-consultation-notification) as soon as the
    // FCM push arrives — usually well before this 10s poll cycle would ever
    // run. Skip the vibrate+notification+navigate fallback below while
    // that's actively ringing so the doctor doesn't get a redundant second
    // alert/navigation stacked underneath the OS call screen. If the doctor
    // declines/ignores it there, isCallActive() goes false and the next poll
    // picks the still-'waiting_for_doctor' row back up normally.
    if (callkeep.isCallActive(waiting.id)) return
    // The root layout may not have mounted its navigator yet (this can fire
    // from the initial-mount effect on a cold launch) — pushing before then
    // throws and silently drops the navigation. Don't mark it shown in that
    // case either, so the next 10s poll cycle retries the whole thing.
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
    ghostDebug('[incoming-consultation] navigating to incoming-request from Home', { consultationId: waiting.id })

    // Routed through the shared dedup helper (already used by the
    // push-notification-tap path in notificationNav.ts) rather than a raw
    // router.push — this surface's own Realtime/poll detection previously
    // could stack a second live instance of this screen for the same
    // consultation on top of one a notification tap (or the Consultations
    // tab) had already pushed, since only the notification path checked the
    // nav tree before navigating.
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

  useEffect(() => {
    if (!doctorProfileId) return

    // Listens for '*' (not just UPDATE) so that the doctor's OWN active
    // consultation flipping to 'completed' also re-triggers a check — that's
    // the only signal that a queued waiting_for_doctor request should now be
    // surfaced (it's a different row, so it never gets its own event otherwise).
    const topic = `doctor-requests-${doctorProfileId}`
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
    if (stale) supabase.removeChannel(stale)

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'consultations',
          filter: `doctor_id=eq.${doctorProfileId}`,
        },
        async (payload) => {
          ghostDebug('[realtime] doctor-requests channel event', {
            doctorProfileId,
            eventType: (payload as any).eventType,
            consultationId: (payload.new as any)?.id ?? (payload.old as any)?.id,
            status: (payload.new as any)?.status,
          })
          const token = await getToken()
          if (!token) return
          const client = getAuthClient(token)
          await Promise.all([
            checkForWaitingRequest(doctorProfileId, token),
            loadTodaySchedule(client),
            refreshStats(doctorProfileId, client),
          ])
        }
      )
      .on(
        // A patient editing their name/photo doesn't touch `consultations` at
        // all, so the subscription above never fires for it — without this,
        // Today's Schedule and the waiting queue keep showing the patient's
        // old identity until the doctor navigates away and back.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        async (payload) => {
          const updated = payload.new as any
          const isRelevant =
            scheduleRef.current.some((s) => s.patientId === updated.id) ||
            queueListRef.current.some((q) => q.patientId === updated.id)
          if (!isRelevant) return
          const token = await getToken()
          if (!token) return
          await Promise.all([
            checkForWaitingRequest(doctorProfileId, token),
            loadTodaySchedule(getAuthClient(token)),
          ])
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel

    // Polling fallback — catches the case where the busy consultation ends
    // (freeing the doctor up) but Realtime doesn't deliver that row's event
    // for some reason, matching the web overlay's 5s poll safety net.
    const poll = setInterval(async () => {
      const token = await getToken()
      if (token) await checkForWaitingRequest(doctorProfileId, token)
    }, 10_000)

    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [doctorProfileId])

  // Realtime sockets get suspended while the OS backgrounds the app (locked
  // screen, app-switch) — a scheduled booking that becomes ready, or a fresh
  // on-demand request, can fire its postgres_changes event while nobody's
  // listening. The 10s poll above only re-checks the waiting-request queue,
  // not Today's Schedule, so a scheduled consultation could still be missed
  // on resume. Mirrors useDoctorOnlineToggle's resyncOnForeground.
  useEffect(() => {
    if (!doctorProfileId) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then(async (token) => {
        if (!token) return
        await Promise.all([
          checkForWaitingRequest(doctorProfileId, token),
          loadTodaySchedule(getAuthClient(token)),
        ])
      })
    })
    return () => sub.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorProfileId])

  // Ordered waiting queue (matches web's IncomingRequestOverlay) — shown so
  // the doctor sees who's next instead of just a count, especially while
  // busy in another consultation and the incoming-request full screen can't
  // be shown yet.
  const [queueList, setQueueList] = useState<{ id: string; patientId: string; patientName: string; waitingStartedAt: string }[]>([])
  useEffect(() => { queueListRef.current = queueList }, [queueList])

  const isPending = doctorStatus && doctorStatus !== 'approved'

  // Only ever shown on the very first load (doctorProfileId still null) —
  // once the dashboard has loaded successfully at least once, a later
  // background refresh failure shouldn't blow away already-displayed data.
  if (isLoadingDashboard && !doctorProfileId) {
    return (
      <SafeAreaView style={[styles.safe, styles.centerFill]} edges={['top']}>
        <ActivityIndicator size="large" color={colors.careBlue} />
      </SafeAreaView>
    )
  }

  if (dashboardLoadError && !doctorProfileId) {
    return (
      <SafeAreaView style={[styles.safe, styles.centerFill]} edges={['top']}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
        <Text style={styles.dashboardErrorText}>{dashboardLoadError}</Text>
        <Pressable style={styles.retryButton} onPress={loadDashboard}>
          <Text style={styles.retryButtonText}>{t('retry', { defaultValue: 'Retry' })}</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* ── Gradient Header ── */}
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{(new Date().getHours() < 12 ? t('goodMorning') : new Date().getHours() < 17 ? t('goodAfternoon') : t('goodEvening'))}, Dr. {firstName}</Text>
            <Text style={styles.dateText}>{getFormattedDate()}</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable style={styles.bellBtn} hitSlop={8} onPress={guardNav(() => router.push('/(doctor)/notifications' as never))}>
              <Ionicons name="notifications-outline" size={24} color={colors.mistWhite} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText} numberOfLines={1}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={guardNav(() => router.push('/(doctor)/(tabs)/profile'))}
              style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
            >
              {(doctorPhotoUrl ?? user?.imageUrl) ? (
                <Image
                  source={{ uri: (doctorPhotoUrl ?? user?.imageUrl) as string }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{firstName[0].toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </LinearGradient>

        {/* ── Pending / Rejected Banner ── */}
        {isPending && (
          <View style={[styles.pendingBanner, (doctorStatus === 'rejected' || doctorStatus === 'suspended') && styles.rejectedBanner]}>
            <Ionicons
              name={doctorStatus === 'rejected' ? 'close-circle-outline' : doctorStatus === 'suspended' ? 'ban-outline' : 'time-outline'}
              size={20}
              color={doctorStatus === 'rejected' || doctorStatus === 'suspended' ? colors.error : '#92400E'}
            />
            <Text style={[styles.pendingBannerText, (doctorStatus === 'rejected' || doctorStatus === 'suspended') && styles.rejectedBannerText]}>
              {doctorStatus === 'rejected'
                ? 'Your application was not approved. Please contact support.'
                : doctorStatus === 'suspended'
                ? 'Your account has been suspended. Please contact support.'
                : 'Your account is under review. You cannot perform any actions until the admin approves you.'}
            </Text>
          </View>
        )}

        <View style={styles.body}>
          {/* ── Online Toggle ── */}
          {!isPending && (
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot}>
                <View style={[styles.onlineDotInner, { backgroundColor: isOnline ? colors.success : colors.steelGrey }]} />
              </View>
              <Text style={styles.onlineLabel}>{isOnline ? 'Online · Taking Patients' : 'Go Online'}</Text>
              <Switch
                value={isOnline}
                onValueChange={toggleOnline}
                disabled={togglingOnline}
                trackColor={{ true: colors.success, false: colors.steelGrey }}
                thumbColor={colors.mistWhite}
              />
            </View>
          )}

          {/* ── Waiting Queue ── */}
          {queueList.length > 0 && (
            <View style={styles.queueCard}>
              <View style={styles.queueHeader}>
                <Ionicons name="time-outline" size={16} color={colors.warning} />
                <Text style={styles.queueHeaderText}>
                  {queueList.length} patient{queueList.length > 1 ? 's' : ''} waiting
                </Text>
              </View>
              {queueList.map((q, i) => (
                <View key={q.id} style={styles.queueItem}>
                  <Text style={styles.queueItemIndex}>{i + 1}.</Text>
                  <Text style={styles.queueItemName} numberOfLines={1}>{q.patientName}</Text>
                  <Text style={styles.queueItemTime}>{formatWaiting(q.waitingStartedAt)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Today's Stats ── */}
          <Text style={styles.sectionTitle}>{t('todayStats')}</Text>
          <View style={styles.statsRow}>
            {[
              { icon: 'medical-outline', value: String(stats.totalConsultations), label: 'Total Consultations', color: colors.careBlue, route: '/(doctor)/(tabs)/consultations' },
              { icon: 'checkmark-circle-outline', value: String(stats.completedToday), label: 'Completed Today', color: colors.tealGreen, route: { pathname: '/(doctor)/(tabs)/consultations', params: { tab: 'completed', dateFilter: 'today' } } },
              { icon: 'star-outline', value: stats.rating > 0 ? stats.rating.toFixed(1) : '—', label: t('rating'), color: colors.warning, route: '/(doctor)/my-reviews' },
              { icon: 'wallet-outline', value: `ETB ${stats.earnings.toLocaleString()}`, label: 'Total Earnings', color: colors.tealGreen, route: '/(doctor)/withdraw' },
            ].map((stat) => (
              <Pressable
                key={stat.label}
                style={({ pressed }) => [styles.statCard, pressed && { opacity: 0.75 }]}
                onPress={guardNav(() => router.push(stat.route as never))}
              >
                <Ionicons name={stat.icon as never} size={22} color={stat.color} />
                <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── Today's Schedule ── */}
          <Text style={[styles.sectionTitle, styles.mt20]}>{t('todaySchedule')}</Text>
          {visibleSchedule.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={40} color={colors.steelGrey} />
              <Text style={styles.emptyText}>{t('noScheduledAppts')}</Text>
            </View>
          ) : (
            visibleSchedule.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.scheduleItem, pressed && { opacity: 0.75 }]}
                onPress={() => setDetailsAppt({
                  id: item.id, type: item.type, status: item.status,
                  patientName: item.patientName, patientPhotoUrl: item.patientPhotoUrl,
                  whenLabel: `Today at ${item.time}`,
                })}
              >
                {item.patientPhotoUrl ? (
                  <Image
                    source={{ uri: item.patientPhotoUrl }}
                    style={styles.scheduleAvatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={0}
                    recyclingKey={item.patientPhotoUrl}
                  />
                ) : (
                  <View style={styles.scheduleIconWrap}>
                    <Ionicons name={CONSULTATION_ICONS[item.type]} size={20} color={colors.inkBlack} />
                  </View>
                )}
                <View style={styles.scheduleInfo}>
                  <Text style={styles.schedulePatient}>{item.patientName}</Text>
                  <Text style={styles.scheduleTime}>{item.time} · {item.type.charAt(0).toUpperCase() + item.type.slice(1)}</Text>
                </View>
                <View style={styles.scheduleDot} />
              </Pressable>
            ))
          )}

          {/* ── Quick Actions ── */}
          <Text style={[styles.sectionTitle, styles.mt20]}>{t('quickActions')}</Text>
          <View style={styles.quickRow}>
            {[
              { icon: 'calendar-outline', label: t('upcomingAppts'), route: '/(doctor)/(tabs)/schedule' },
              { icon: 'cash-outline', label: t('earnings'), route: '/(doctor)/withdraw' },
              { icon: 'star-outline', label: t('myReviews'), route: '/(doctor)/my-reviews' },
            ].map((action) => (
              <Pressable
                key={action.label}
                onPress={guardNav(() => router.push(action.route as never))}
                style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name={action.icon as never} size={24} color={colors.careBlue} />
                <Text style={styles.quickLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 24 }} />
        </View>
      </ScrollView>
      <AppointmentDetailsSheet
        appt={detailsAppt}
        onClose={() => setDetailsAppt(null)}
        onJoin={(appt) => {
          setDetailsAppt(null)
          const params = { patientName: appt.patientName, consultationId: appt.id }
          if (appt.type === 'chat') router.push({ pathname: '/(doctor)/chat-consultation', params })
          else if (appt.type === 'phone') router.push({ pathname: '/(doctor)/phone-consultation', params })
          else router.push({ pathname: '/(doctor)/video-consultation', params })
        }}
        onViewSummary={(appt) => {
          setDetailsAppt(null)
          router.push({ pathname: '/(doctor)/consultation-summary', params: { consultationId: appt.id, patientName: appt.patientName } })
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  centerFill: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  dashboardErrorText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack, textAlign: 'center' },
  retryButton: { backgroundColor: colors.careBlue, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  retryButtonText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  scrollContent: { paddingBottom: 24 },
  body: { paddingHorizontal: 20, paddingTop: 16 },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellBtn: { position: 'relative', padding: 4 },
  bellBadge: {
    position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.careBlue,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  bellBadgeText: { fontFamily: fonts.bold, fontSize: 9, color: colors.mistWhite, lineHeight: 11 },
  greeting: { fontFamily: fonts.bold, fontSize: 20, color: colors.mistWhite, lineHeight: 26 },
  dateText: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  avatarBtn: { borderRadius: 22 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 18, color: colors.mistWhite },

  pendingBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FEF3C7', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  rejectedBanner: { backgroundColor: '#FEE2E2', borderBottomColor: '#FECACA' },
  pendingBannerText: { fontFamily: fonts.medium, fontSize: 13, color: '#92400E', flex: 1, lineHeight: 18 },
  rejectedBannerText: { color: colors.error },

  onlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    marginBottom: 16, ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  onlineDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  onlineDotInner: { width: 10, height: 10, borderRadius: 5 },
  onlineLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, flex: 1 },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack, marginBottom: 12 },
  mt20: { marginTop: 20 },

  queueCard: {
    backgroundColor: colors.mistWhite, borderRadius: 14, marginBottom: 16, overflow: 'hidden',
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  queueHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF7ED', paddingHorizontal: 14, paddingVertical: 10,
  },
  queueHeaderText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.warning },
  queueItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  queueItemIndex: { fontFamily: fonts.semiBold, fontSize: 12, color: '#9CA3AF', width: 14 },
  queueItemName: { flex: 1, fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack },
  queueItemTime: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  statValue: { fontFamily: fonts.bold, fontSize: 16 },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', textAlign: 'center' },

  scheduleItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  scheduleIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  scheduleAvatar: { width: 42, height: 42, borderRadius: 12 },
  scheduleTypeIcon: { fontSize: 20 },
  scheduleInfo: { flex: 1 },
  schedulePatient: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  scheduleTime: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  scheduleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealGreen },

  emptyWrap: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#9CA3AF' },

  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flex: 1, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14, alignItems: 'center', gap: 8,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkBlack, textAlign: 'center' },
})
