import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

type TabKey = 'incoming' | 'active' | 'completed' | 'cancelled'
type ConsultationType = 'chat' | 'phone' | 'video'

interface ConsultationItem {
  id: string
  patientName: string
  patientId: string
  type: ConsultationType
  time: string
  status: TabKey
  createdAt: string
}

function toTabKey(status: string): TabKey {
  if (status === 'pending') return 'incoming'
  if (status === 'active') return 'active'
  if (status === 'cancelled') return 'cancelled'
  return 'completed'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs === 1) return '1 hr ago'
  if (hrs < 24) return `${hrs} hrs ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const TYPE_ICONS: Record<ConsultationType, string> = { chat: '💬', phone: '📞', video: '🎥' }
const TYPE_COLORS: Record<ConsultationType, string> = {
  chat: '#EFF6FF',
  phone: '#F0FDF4',
  video: '#FFF7ED',
}

/** Live countdown badge for incoming requests. Counts down from 30 seconds from when the consultation was created. */
function CountdownBadge({ createdAt }: { createdAt: string }) {
  const getRemaining = () => {
    const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
    return Math.max(0, 30 - elapsed)
  }
  const [remaining, setRemaining] = useState(getRemaining)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining(getRemaining())
    }, 500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  // createdAt won't change so no dep needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const urgent = remaining <= 10
  return (
    <View style={[styles.timerBadge, urgent && styles.timerBadgeUrgent]}>
      <Text style={[styles.timerText, urgent && styles.timerTextUrgent]}>{remaining}s</Text>
    </View>
  )
}

export default function ConsultationsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { getToken } = useAuth()
  const { doctorStatus } = useDoctorStore()
  const [activeTab, setActiveTab] = useState<TabKey>('incoming')
  const [consultations, setConsultations] = useState<ConsultationItem[]>([])

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'incoming', label: t('incomingConsultations') },
    { key: 'active', label: t('activeConsultations') },
    { key: 'completed', label: t('completedConsultations') },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  useEffect(() => {
    getToken().then(token => {
      if (!token) return
      getAuthClient(token)
        .from('consultations')
        .select(`
          id, type, status, created_at,
          patient:users!consultations_patient_id_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (!data) return
          setConsultations(data.map((r: any) => ({
            id: r.id,
            patientName: r.patient?.full_name ?? 'Patient',
            patientId: r.patient?.id ?? '',
            type: (r.type ?? 'chat') as ConsultationType,
            time: timeAgo(r.created_at),
            status: toTabKey(r.status),
            createdAt: r.created_at,
          })))
        })
    })
  }, [])

  const filtered = consultations.filter((c) => c.status === activeTab)

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
    if (item.status === 'cancelled') return
    const params = { patientName: item.patientName, consultationId: item.id }
    if (item.type === 'chat') router.push({ pathname: '/(doctor)/chat-consultation', params })
    else if (item.type === 'phone') router.push({ pathname: '/(doctor)/phone-consultation', params })
    else router.push({ pathname: '/(doctor)/video-consultation', params })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Text style={styles.headerTitle}>{t('consultationsTab')}</Text>
      </LinearGradient>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsRow}>
        {TABS.map((tab) => {
          const count = consultations.filter((c) => c.status === tab.key).length
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

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="medical-outline" size={48} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>{t('noConsultationsYet')}</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'incoming' ? `${t('goOnline')} →` : t('noConsultationsYet')}
            </Text>
          </View>
        ) : (
          filtered.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleOpenConsultation(item)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, item.status === 'cancelled' && styles.cardCancelled]}
            >
              <View style={[styles.typeIconWrap, { backgroundColor: TYPE_COLORS[item.type] }]}>
                <Text style={styles.typeIcon}>{TYPE_ICONS[item.type]}</Text>
              </View>

              <View style={styles.cardInfo}>
                <Text style={[styles.patientName, item.status === 'cancelled' && { color: '#9CA3AF' }]}>{item.patientName}</Text>
                <Text style={styles.cardMeta}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)} · {item.time}</Text>
              </View>

              {item.status === 'incoming' && (
                <CountdownBadge createdAt={item.createdAt} />
              )}
              {item.status === 'active' && (
                <View style={styles.activeBadge}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeText}>Live</Text>
                </View>
              )}
              {item.status === 'completed' && (
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              )}
              {item.status === 'cancelled' && (
                <Ionicons name="close-circle" size={22} color="#9CA3AF" />
              )}
            </Pressable>
          ))
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

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 14,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  cardCancelled: { opacity: 0.65 },
  typeIconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  typeIcon: { fontSize: 22 },
  cardInfo: { flex: 1 },
  patientName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 3 },

  timerBadge: { backgroundColor: '#FFF3CD', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#FFC107' },
  timerBadgeUrgent: { backgroundColor: '#FEE2E2', borderColor: colors.error },
  timerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.warning },
  timerTextUrgent: { color: colors.error },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  activeText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#15803D' },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center' },
})
