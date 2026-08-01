import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { shadow } from '@/lib/shadow'
import { ethiopiaTodayRange } from '@/lib/slotGeneration'
import { getAuthClient } from '@/lib/supabase'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { navigateFamilyRoute } from '@/lib/notificationNav'
import { subscribeRealtime } from '@/lib/realtimeChannelManager'
import { useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

// Unbounded (P3-27) — a doctor's full lifetime consultation history was
// fetched on every focus/realtime event/foreground with no cap at all. 200
// covers realistic tab/search/badge usage (recent-first) without the query
// cost and payload size growing forever; older rows remain reachable via
// Consultation History, which paginates independently.
const CONSULTATIONS_LIST_LIMIT = 200

// "all" is a UI-only meta-tab (shows every row regardless of status) and is
// never a value assigned to an individual consultation.
type TabKey = 'all' | 'incoming' | 'active' | 'completed' | 'cancelled'
// Canonical status → bucket mapping, kept identical (in intent) to the
// website's tab filter in carehub-web/app/doctor/consultations/page.tsx:
//   pending, waiting_for_doctor          -> incoming ("pending" on web)
//   accepted, in_progress, active        -> active
//   completed                            -> completed
//   cancelled                            -> cancelled
//   declined, doctor_missed, no_show,
//   pending_payment                      -> other (not counted under any
//                                           single-status tab on either
//                                           platform — only visible via "All")
type StatusBucket = 'incoming' | 'active' | 'completed' | 'cancelled' | 'other'
type ConsultationType = 'chat' | 'phone' | 'video'

interface ConsultationItem {
  id: string
  patientName: string
  patientId: string
  patientPhotoUrl: string | null
  type: ConsultationType
  dateTimeLabel: string
  status: StatusBucket
  rawStatus: string
  createdAt: string
  endedAt: string | null
  doctorAmount: number
  statusChangedAt: string
  doctorViewedAt: string | null
}

// Unread = the doctor has never opened the tab this row currently lives in
// since it last changed status. Source of truth: consultations.doctor_viewed_at
// vs. consultations.status_changed_at (see migration 071) — no existing
// column tracked doctor-seen state for consultations before this.
const isUnread = (c: ConsultationItem) =>
  !c.doctorViewedAt || new Date(c.doctorViewedAt) < new Date(c.statusChangedAt)

const CONSULTATIONS_SELECT = `
  id, type, status, created_at, started_at, scheduled_at, ended_at, doctor_amount,
  status_changed_at, doctor_viewed_at,
  patient:users!consultations_patient_id_fkey(id, full_name, profile_photo_url)
`

function mapConsultationRow(r: any): ConsultationItem {
  return {
    id: r.id,
    patientName: r.patient?.full_name ?? 'Patient',
    patientId: r.patient?.id ?? '',
    patientPhotoUrl: r.patient?.profile_photo_url ?? null,
    type: (r.type ?? 'chat') as ConsultationType,
    dateTimeLabel: formatDateTime(r.started_at ?? r.scheduled_at ?? r.created_at),
    status: toStatusBucket(r.status),
    rawStatus: r.status,
    createdAt: r.created_at,
    endedAt: r.ended_at ?? null,
    doctorAmount: Number(r.doctor_amount) || 0,
    statusChangedAt: r.status_changed_at ?? r.created_at,
    doctorViewedAt: r.doctor_viewed_at ?? null,
  }
}

const VALID_TABS: TabKey[] = ['all', 'incoming', 'active', 'completed', 'cancelled']
function resolveTab(raw: string | string[] | undefined): TabKey {
  const key = Array.isArray(raw) ? raw[0] : raw
  return (VALID_TABS as string[]).includes(key ?? '') ? (key as TabKey) : 'all'
}

function toStatusBucket(status: string): StatusBucket {
  if (status === 'pending' || status === 'waiting_for_doctor') return 'incoming'
  if (status === 'accepted' || status === 'in_progress' || status === 'active') return 'active'
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  // declined, doctor_missed, no_show, pending_payment, etc. — not folded into
  // Cancelled (that previously inflated the Cancelled count vs. the website).
  return 'other'
}

// Mirrors website's formatDateTime() in carehub-web/lib/utils.ts.
function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${date} at ${time}`
}

function statusLabel(status: string): string {
  return status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const TYPE_ICONS: Record<ConsultationType, string> = { chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam' }
const TYPE_COLORS: Record<ConsultationType, string> = {
  chat: '#EFF6FF',
  phone: '#F0FDF4',
  video: '#FFF7ED',
}
const TYPE_ICON_COLORS: Record<ConsultationType, string> = {
  chat: '#3B82F6',
  phone: '#22C55E',
  video: '#F97316',
}

// Status pill colors — reuses the same palette convention already
// established for consultation status in app/(doctor)/consultation-history.tsx
// (colors.success / colors.error / colors.interactiveBlue / '#F59E0B'), paired
// with light tint backgrounds consistent with this file's TYPE_COLORS.
const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FFFBEB', text: '#F59E0B' },
  waiting_for_doctor: { bg: '#FFFBEB', text: '#F59E0B' },
  accepted: { bg: '#EFF6FF', text: colors.interactiveBlue },
  in_progress: { bg: '#EFF6FF', text: colors.interactiveBlue },
  active: { bg: '#EFF6FF', text: colors.interactiveBlue },
  completed: { bg: '#F0FDF4', text: colors.success },
  cancelled: { bg: '#F3F4F6', text: colors.error },
  declined: { bg: '#F3F4F6', text: colors.error },
  doctor_missed: { bg: '#F3F4F6', text: colors.error },
  no_show: { bg: '#F3F4F6', text: colors.error },
  pending_payment: { bg: '#FFFBEB', text: '#F59E0B' },
}

export default function ConsultationsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { doctorStatus } = useDoctorStore()
  const guardNav = useNavGuard()
  // dateFilter=today comes from Home's "Completed Today" stat card — same
  // ended_at >= todayStartIso boundary that card's own count uses, so the
  // two numbers can never disagree.
  const params = useLocalSearchParams<{ tab?: string; dateFilter?: string }>()
  const isTodayOnly = params.dateFilter === 'today'
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [consultations, setConsultations] = useState<ConsultationItem[]>([])
  // True until the first fetch (this mount/focus) actually completes — used
  // to gate the "No consultations yet" empty state so it can never render
  // while `consultations` is merely still its initial `[]`, only once the
  // server has genuinely confirmed there are none.
  const [isLoading, setIsLoading] = useState(true)
  // Mirrors `consultations` so the users-table realtime handler (below) can
  // check "is this changed patient one of mine?" without a stale closure.
  const consultationsRef = useRef<ConsultationItem[]>([])
  useEffect(() => { consultationsRef.current = consultations }, [consultations])
  const [search, setSearch] = useState('')
  const [profileId, setProfileId] = useState<string | null>(null)
  const consultationsCacheKey = user?.id ? `doctor-consultations-list:${user.id}` : null

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'incoming', label: t('incomingConsultations') },
    { key: 'active', label: t('activeConsultations') },
    { key: 'completed', label: t('completedConsultations') },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  const bucketMatches = (c: ConsultationItem, tab: TabKey) => tab === 'all' || c.status === tab

  // Marks every currently-unread consultation visible in `tab` as viewed —
  // clears that tab's badge immediately (locally, and in the DB so the
  // website and any other device see the same read state without a refresh).
  const markTabRead = useCallback((tab: TabKey, items: ConsultationItem[]) => {
    const unreadIds = items.filter((c) => bucketMatches(c, tab) && isUnread(c)).map((c) => c.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setConsultations((prev) => prev.map((c) => (unreadIds.includes(c.id) ? { ...c, doctorViewedAt: now } : c)))
    getToken().then((token) => {
      if (!token) return
      getAuthClient(token).from('consultations').update({ doctor_viewed_at: now }).in('id', unreadIds).then(() => {})
    })
  }, [getToken])

  // Paint the last-known list from disk immediately on mount — before this
  // even reaches its first real fetch, so a warm start shows real rows
  // instead of the loading spinner (which only appears when there's nothing
  // cached yet, e.g. the very first-ever launch).
  useEffect(() => {
    if (!consultationsCacheKey) return
    let cancelled = false
    getCachedJson<ConsultationItem[]>(consultationsCacheKey).then((cached) => {
      if (cached && !cancelled) setConsultations(cached)
    })
    return () => { cancelled = true }
  }, [consultationsCacheKey])

  // Tab screens stay mounted across tab switches, so a plain mount-only
  // fetch never sees a patient's photo edited while this tab was in the
  // background — re-fetch on every return to this tab instead. Also reset
  // to the "All" tab on every visit (bottom nav, notification, deep link,
  // cold launch) unless a tab was explicitly passed as a route param —
  // otherwise this screen, which stays mounted between visits, kept
  // whatever tab the doctor had last selected.
  useFocusEffect(
    useCallback(() => {
      const targetTab: TabKey = resolveTab(params.tab)
      setActiveTab(targetTab)
      setIsLoading(true)
      ;(async () => {
        try {
          const token = await getToken()
          if (!token) { setIsLoading(false); return }
          const { data } = await getAuthClient(token)
            .from('consultations')
            .select(CONSULTATIONS_SELECT)
            .order('created_at', { ascending: false })
            .limit(CONSULTATIONS_LIST_LIMIT)
          setIsLoading(false)
          if (!data) return
          const items = data.map(mapConsultationRow)
          setConsultations(items)
          if (consultationsCacheKey) setCachedJson(consultationsCacheKey, items)
          markTabRead(targetTab, items)
        } catch {
          // A network failure anywhere above (offline, dropped connection)
          // otherwise left isLoading stuck true forever — nothing previously
          // caught a rejected request, so the spinner never cleared. Falls
          // back to whatever cached/previous list is already on screen.
          setIsLoading(false)
        }
      })()
    // getToken deliberately excluded: @react-navigation's useFocusEffect
    // re-runs this callback immediately whenever ITS identity changes, not
    // just on real focus/blur — Clerk's getToken is a new function reference
    // on unrelated re-renders, which was silently re-firing setActiveTab(targetTab)
    // (snapping back to All) every few seconds while the doctor sat on a
    // manually-selected tab. getToken() always fetches a live token when
    // called, so a "stale" closure over it is safe here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.tab])
  )

  // Resolve this doctor's profile id once, purely to scope the realtime
  // subscription below (list fetches above are already scoped by RLS).
  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const { data: me } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!me) return
      const { data: profile } = await client
        .from('doctor_profiles')
        .select('id')
        .eq('user_id', (me as any).id)
        .maybeSingle()
      if (profile) setProfileId(profile.id)
    })()
  }, [user?.id, getToken])

  // Patches a single changed consultation row in place instead of refetching
  // the entire (now merely bounded, not eliminated) list on every realtime
  // event (P3-27) — also moved onto the shared refcounted channel manager
  // instead of a `Date.now()`-suffixed one-off channel (P3-30), matching the
  // singleton pattern already used elsewhere (see usePatientAppointments.ts).
  const patchConsultationRow = useCallback(async (event: 'INSERT' | 'UPDATE' | 'DELETE', payload: any) => {
    if (event === 'DELETE') {
      const oldId = payload.old?.id
      if (oldId) setConsultations((prev) => prev.filter((c) => c.id !== oldId))
      return
    }
    const id = payload.new?.id
    if (!id) return
    const token = await getToken()
    if (!token) return
    const { data } = await getAuthClient(token)
      .from('consultations')
      .select(CONSULTATIONS_SELECT)
      .eq('id', id)
      .maybeSingle()
    if (!data) return
    const item = mapConsultationRow(data)
    setConsultations((prev) => {
      const idx = prev.findIndex((c) => c.id === item.id)
      if (idx === -1) return [item, ...prev]
      const next = [...prev]
      next[idx] = item
      return next
    })
  }, [getToken])

  // Live-refresh whenever any of this doctor's consultations change (new
  // incoming request, status change, etc.) so tab badges update instantly
  // while the doctor is sitting on this screen — no refresh or reopen needed.
  useEffect(() => {
    if (!profileId) return
    return subscribeRealtime(
      `doctor-consultations:${profileId}`,
      [
        { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${profileId}` },
        // A patient editing their name/photo doesn't touch `consultations`
        // at all, so the filter above never fires for it — without this, a
        // doctor sitting on this tab keeps seeing the patient's old identity
        // until they navigate away and back.
        { event: 'UPDATE', schema: 'public', table: 'users' },
      ],
      (event, payload) => {
        const table = (payload as any).table as string | undefined
        if (table === 'users') {
          const updated = payload.new as any
          if (!consultationsRef.current.some((c) => c.patientId === updated.id)) return
          setConsultations((prev) => prev.map((c) => (
            c.patientId === updated.id
              ? { ...c, patientName: updated.full_name ?? c.patientName, patientPhotoUrl: updated.profile_photo_url ?? c.patientPhotoUrl }
              : c
          )))
          return
        }
        patchConsultationRow(event, payload)
      },
    )
  // patchConsultationRow deliberately excluded — it closes over Clerk's
  // getToken, a new function reference on unrelated re-renders (see the
  // useFocusEffect above), which would otherwise tear down and recreate this
  // subscription continuously instead of once per profileId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Realtime sockets get suspended while the OS backgrounds the app (locked
  // screen, app-switch) — a new/updated consultation can fire its
  // postgres_changes event while nobody's listening. useFocusEffect above
  // only refetches on tab-navigation focus, not on returning to the
  // foreground while already sitting on this tab, so without this a doctor
  // who backgrounds the app mid-session would need to switch tabs away and
  // back (or restart) to see a new request. Mirrors useDoctorOnlineToggle's
  // resyncOnForeground.
  useEffect(() => {
    if (!profileId) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      getToken().then(async (token) => {
        if (!token) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select(CONSULTATIONS_SELECT)
          .order('created_at', { ascending: false })
          .limit(CONSULTATIONS_LIST_LIMIT)
        if (data) setConsultations(data.map(mapConsultationRow))
      })
    })
    return () => sub.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const searchMatches = (c: ConsultationItem) =>
    !search.trim() || c.patientName.toLowerCase().includes(search.trim().toLowerCase())

  const { startIso: todayStartIso } = ethiopiaTodayRange()
  const todayMatches = (c: ConsultationItem) =>
    !isTodayOnly || (!!c.endedAt && c.endedAt >= todayStartIso)

  const filtered = consultations.filter((c) => bucketMatches(c, activeTab) && searchMatches(c) && todayMatches(c))

  const handleTabPress = (tab: TabKey) => {
    setActiveTab(tab)
    markTabRead(tab, consultations)
  }

  const handleOpenConsultation = (item: ConsultationItem) => {
    if (doctorStatus && doctorStatus !== 'approved' && item.status !== 'completed') {
      Alert.alert(
        'Account Under Review',
        'You cannot join or manage consultations until your account is approved by admin.'
      )
      return
    }
    if (item.status === 'incoming') {
      // Shared dedup helper (see home.tsx's checkForWaitingRequest) — a raw
      // router.push here could stack a second live incoming-request instance
      // on top of one Home's own detection (or a notification tap) already
      // pushed for this same consultation.
      navigateFamilyRoute(
        router,
        rootNavigationState,
        '/(doctor)/incoming-request',
        { patientName: item.patientName, consultationType: item.type, consultationId: item.id },
        'push',
      )
      return
    }
    if (item.status === 'cancelled' || item.status === 'completed' || item.status === 'other') return
    const params = { patientName: item.patientName, consultationId: item.id, patientId: item.patientId }
    if (item.type === 'chat') router.push({ pathname: '/(doctor)/chat-consultation', params })
    else if (item.type === 'phone') router.push({ pathname: '/(doctor)/phone-consultation', params })
    else router.push({ pathname: '/(doctor)/video-consultation', params })
  }

  const handleViewSummary = (item: ConsultationItem) => {
    router.push({ pathname: '/(doctor)/consultation-summary', params: { consultationId: item.id, patientName: item.patientName } })
  }

  const handleViewHistory = (item: ConsultationItem) => {
    if (!item.patientId) return
    router.push({
      pathname: '/(doctor)/patient-history',
      params: { patientId: item.patientId, patientName: item.patientName, consultationId: item.id },
    })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Text style={styles.headerTitle}>{t('consultationsTab')}</Text>
        {isTodayOnly && (
          <Pressable onPress={() => router.setParams({ dateFilter: '' })} style={styles.todayFilterChip}>
            <Text style={styles.todayFilterChipText}>Today only</Text>
            <Ionicons name="close-circle" size={14} color={colors.mistWhite} />
          </Pressable>
        )}
      </LinearGradient>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search patient name…"
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsRow}>
        {TABS.map((tab) => {
          const count = consultations.filter((c) => bucketMatches(c, tab.key) && isUnread(c)).length
          const active = activeTab === tab.key
          return (
            <Pressable key={tab.key} onPress={() => handleTabPress(tab.key)} style={styles.tabBtn}>
              {active && <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.tabActiveGrad} />}
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
              {count > 0 && (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>{count}</Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </ScrollView>

      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.listContent, filtered.length === 0 && styles.listContentEmpty]}
        showsVerticalScrollIndicator={false}
        data={filtered}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="small" color={colors.steelGrey} />
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="medical-outline" size={48} color={colors.steelGrey} />
              <Text style={styles.emptyTitle}>{t('noConsultationsYet')}</Text>
              <Text style={styles.emptyText}>
                {activeTab === 'incoming' ? `${t('goOnline')} →` : t('noConsultationsYet')}
              </Text>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: 24 }} />}
        renderItem={({ item }) => {
          const pill = STATUS_PILL[item.rawStatus] ?? { bg: '#F3F4F6', text: '#6B7280' }
          return (
            <Pressable
              onPress={guardNav(() => handleOpenConsultation(item))}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, item.status === 'cancelled' && styles.cardCancelled]}
            >
              <View style={[styles.typeIconWrap, { backgroundColor: TYPE_COLORS[item.type] }]}>
                <Ionicons name={TYPE_ICONS[item.type] as any} size={22} color={TYPE_ICON_COLORS[item.type]} />
              </View>

              <View style={styles.cardInfo}>
                <View style={styles.patientRow}>
                  {item.patientPhotoUrl ? (
                    <Image
                      source={{ uri: item.patientPhotoUrl }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={0}
                      recyclingKey={item.patientPhotoUrl}
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>{item.patientName.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={[styles.patientName, item.status === 'cancelled' && { color: '#9CA3AF' }]} numberOfLines={1}>
                    {item.patientName}
                  </Text>
                </View>
                <Text style={styles.cardMeta}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)} · {item.dateTimeLabel}</Text>
                <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                  <Text style={[styles.statusPillText, { color: pill.text }]}>{statusLabel(item.rawStatus)}</Text>
                </View>
              </View>

              <View style={styles.cardRight}>
                {item.status === 'active' && (
                  <View style={styles.activeBadge}>
                    <View style={styles.activeDot} />
                    <Text style={styles.activeText}>Live</Text>
                  </View>
                )}
                {item.status === 'completed' && (
                  <View style={styles.completedActions}>
                    <Pressable style={styles.completedActionBtn} onPress={() => handleViewSummary(item)} hitSlop={6}>
                      <Text style={styles.completedActionText}>Summary</Text>
                    </Pressable>
                    <Pressable style={styles.completedActionBtn} onPress={() => handleViewHistory(item)} hitSlop={6}>
                      <Text style={styles.completedActionText}>History</Text>
                    </Pressable>
                  </View>
                )}
                {item.status === 'cancelled' && (
                  <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                )}
                {item.status !== 'completed' && item.status !== 'incoming' && item.patientId && (
                  <Pressable style={styles.completedActionBtn} onPress={() => handleViewHistory(item)} hitSlop={6}>
                    <Text style={styles.completedActionText}>History</Text>
                  </Pressable>
                )}
                {item.doctorAmount > 0 && (
                  <Text style={styles.earningsText}>+ETB {item.doctorAmount}</Text>
                )}
              </View>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite },
  todayFilterChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, marginTop: 8,
  },
  todayFilterChipText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.mistWhite },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.mistWhite,
    margin: 16,
    marginBottom: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, padding: 0 },

  // Explicit height (tabBtn height 38 + tabsRow paddingVertical 8+8) is required
  // here — a horizontal ScrollView with no explicit height, sitting directly
  // above a flex:1 sibling in a column, measures as unbounded on Android and
  // stretches to fill the remaining space instead of hugging its content,
  // which pushed the entire list down behind a large blank area.
  tabsScroll: { height: 54, flexGrow: 0, flexShrink: 0, backgroundColor: colors.mistWhite, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  tabsRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  tabBtn: { height: 38, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: colors.cloudGrey, paddingHorizontal: 12 },
  tabActiveGrad: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12 },
  tabLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },
  tabLabelActive: { color: colors.mistWhite },
  tabBadge: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.steelGrey, alignItems: 'center', justifyContent: 'center' },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tabBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#6B7280' },
  tabBadgeTextActive: { color: colors.mistWhite },

  list: { flex: 1 },
  listContent: { padding: 16, gap: 10 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  cardCancelled: { opacity: 0.65 },
  typeIconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 3 },
  patientRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatarImg: { width: 22, height: 22, borderRadius: 11 },
  avatarFallback: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.tealGreen, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontFamily: fonts.bold, fontSize: 11, color: colors.mistWhite },
  patientName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, flexShrink: 1 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  statusPill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  statusPillText: { fontFamily: fonts.semiBold, fontSize: 10, textTransform: 'capitalize' },

  cardRight: { alignItems: 'flex-end', gap: 6 },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  activeText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#15803D' },

  completedActions: { flexDirection: 'row', gap: 8 },
  completedActionBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#F0FDF4' },
  completedActionText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.tealGreen },
  earningsText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.tealGreen },

  emptyWrap: { alignItems: 'center', paddingVertical: 34, gap: 10 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center' },
})
