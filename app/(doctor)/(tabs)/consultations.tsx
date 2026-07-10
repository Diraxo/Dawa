import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  Alert,
  Image,
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
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

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
  doctorAmount: number
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
  const { getToken } = useAuth()
  const { doctorStatus } = useDoctorStore()
  const [activeTab, setActiveTab] = useState<TabKey>('incoming')
  const [consultations, setConsultations] = useState<ConsultationItem[]>([])
  const [search, setSearch] = useState('')

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'incoming', label: t('incomingConsultations') },
    { key: 'active', label: t('activeConsultations') },
    { key: 'completed', label: t('completedConsultations') },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  // Tab screens stay mounted across tab switches, so a plain mount-only
  // fetch never sees a patient's photo edited while this tab was in the
  // background — re-fetch on every return to this tab instead.
  useFocusEffect(
    useCallback(() => {
      getToken().then(token => {
        if (!token) return
        getAuthClient(token)
          .from('consultations')
          .select(`
            id, type, status, created_at, started_at, scheduled_at, doctor_amount,
            patient:users!consultations_patient_id_fkey(id, full_name, profile_photo_url)
          `)
          .order('created_at', { ascending: false })
          .then(({ data }) => {
            if (!data) return
            setConsultations(data.map((r: any) => ({
              id: r.id,
              patientName: r.patient?.full_name ?? 'Patient',
              patientId: r.patient?.id ?? '',
              patientPhotoUrl: r.patient?.profile_photo_url ?? null,
              type: (r.type ?? 'chat') as ConsultationType,
              dateTimeLabel: formatDateTime(r.started_at ?? r.scheduled_at ?? r.created_at),
              status: toStatusBucket(r.status),
              rawStatus: r.status,
              createdAt: r.created_at,
              doctorAmount: Number(r.doctor_amount) || 0,
            })))
          })
      })
    }, [getToken])
  )

  const bucketMatches = (c: ConsultationItem, tab: TabKey) => tab === 'all' || c.status === tab
  const searchMatches = (c: ConsultationItem) =>
    !search.trim() || c.patientName.toLowerCase().includes(search.trim().toLowerCase())

  const filtered = consultations.filter((c) => bucketMatches(c, activeTab) && searchMatches(c))

  const handleOpenConsultation = (item: ConsultationItem) => {
    if (doctorStatus && doctorStatus !== 'approved' && item.status !== 'completed') {
      Alert.alert(
        'Account Under Review',
        'You cannot join or manage consultations until your account is approved by admin.'
      )
      return
    }
    if (item.status === 'incoming') {
      router.push({
        pathname: '/(doctor)/incoming-request',
        params: { patientName: item.patientName, consultationType: item.type, consultationId: item.id },
      })
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
          const count = consultations.filter((c) => bucketMatches(c, tab.key)).length
          const active = activeTab === tab.key
          return (
            <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={styles.tabBtn}>
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

      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, filtered.length === 0 && styles.listContentEmpty]}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="medical-outline" size={48} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>{t('noConsultationsYet')}</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'incoming' ? `${t('goOnline')} →` : t('noConsultationsYet')}
            </Text>
          </View>
        ) : (
          filtered.map((item) => {
            const pill = STATUS_PILL[item.rawStatus] ?? { bg: '#F3F4F6', text: '#6B7280' }
            return (
            <Pressable
              key={item.id}
              onPress={() => handleOpenConsultation(item)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, item.status === 'cancelled' && styles.cardCancelled]}
            >
              <View style={[styles.typeIconWrap, { backgroundColor: TYPE_COLORS[item.type] }]}>
                <Ionicons name={TYPE_ICONS[item.type] as any} size={22} color={TYPE_ICON_COLORS[item.type]} />
              </View>

              <View style={styles.cardInfo}>
                <View style={styles.patientRow}>
                  {item.patientPhotoUrl ? (
                    <Image source={{ uri: item.patientPhotoUrl }} style={styles.avatarImg} />
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
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 24, color: colors.mistWhite },

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

  tabsScroll: { backgroundColor: colors.mistWhite, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
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
