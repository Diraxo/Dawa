import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
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
import { getAuthClient } from '@/lib/supabase'

type TabKey = 'incoming' | 'active' | 'completed'
type ConsultationType = 'chat' | 'phone' | 'video'

interface ConsultationItem {
  id: string
  patientName: string
  patientId: string
  type: ConsultationType
  time: string
  status: TabKey
}

function toTabKey(status: string): TabKey {
  if (status === 'pending') return 'incoming'
  if (status === 'active') return 'active'
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

const TABS: { key: TabKey; label: string }[] = [
  { key: 'incoming', label: 'Incoming' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
]

export default function ConsultationsScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('incoming')
  const [consultations, setConsultations] = useState<ConsultationItem[]>([])

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
          })))
        })
    })
  }, [])

  const filtered = consultations.filter((c) => c.status === activeTab)

  const handleOpenConsultation = (item: ConsultationItem) => {
    if (item.status === 'incoming') {
      router.push({
        pathname: '/(doctor)/incoming-request',
        params: { patientName: item.patientName, consultationType: item.type, consultationId: item.id },
      })
      return
    }
    const params = { patientName: item.patientName, consultationId: item.id }
    if (item.type === 'chat') router.push({ pathname: '/(doctor)/chat-consultation', params })
    else if (item.type === 'phone') router.push({ pathname: '/(doctor)/phone-consultation', params })
    else router.push({ pathname: '/(doctor)/video-consultation', params })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Text style={styles.headerTitle}>Consultations</Text>
        <Text style={styles.headerSub}>Manage your patient sessions</Text>
      </LinearGradient>

      {/* Tabs */}
      <View style={styles.tabsRow}>
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
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="medical-outline" size={48} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>No {activeTab} consultations</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'incoming' ? 'Go online to receive consultation requests' : 'Consultations will appear here'}
            </Text>
          </View>
        ) : (
          filtered.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleOpenConsultation(item)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            >
              <View style={[styles.typeIconWrap, { backgroundColor: TYPE_COLORS[item.type] }]}>
                <Text style={styles.typeIcon}>{TYPE_ICONS[item.type]}</Text>
              </View>

              <View style={styles.cardInfo}>
                <Text style={styles.patientName}>{item.patientName}</Text>
                <Text style={styles.cardMeta}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)} · {item.time}</Text>
              </View>

              {item.status === 'incoming' && (
                <View style={styles.timerBadge}>
                  <Text style={styles.timerText}>30s</Text>
                </View>
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
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  tabsRow: { flexDirection: 'row', backgroundColor: colors.mistWhite, paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  tabBtn: { flex: 1, height: 38, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: colors.cloudGrey },
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
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  typeIconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  typeIcon: { fontSize: 22 },
  cardInfo: { flex: 1 },
  patientName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 3 },

  timerBadge: { backgroundColor: '#FFF3CD', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#FFC107' },
  timerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.warning },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  activeText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#15803D' },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center' },
})
