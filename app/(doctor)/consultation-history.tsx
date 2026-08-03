import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
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
import { useNavGuard } from '@/hooks/useNavGuard'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

interface ConsultRow {
  id: string
  type: 'chat' | 'phone' | 'video'
  status: string
  patientName: string
  patientPhotoUrl: string | null
  startedAt: string | null
  scheduledAt: string | null
  createdAt: string | null
  endedAt: string | null
  amount: number
}

// Doctor-side "when did this happen" derivation, kept identical (in intent)
// to the patient-side and website equivalents — prefer the real session
// start time, fall back to the booking time, fall back to row creation.
function displayTimestamp(row: ConsultRow): string | null {
  return row.startedAt ?? row.scheduledAt ?? row.createdAt
}

// Duration in minutes for a completed consultation. Chat consultations in
// particular don't always set `started_at`, so fall back to `created_at` as
// the session start rather than silently showing no duration at all.
function displayDurationMinutes(row: ConsultRow): number | null {
  if (!row.endedAt) return null
  const start = row.startedAt ?? row.createdAt
  if (!start) return null
  return Math.round((new Date(row.endedAt).getTime() - new Date(start).getTime()) / 60000)
}

const TYPE_ICONS: Record<string, string> = { chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam' }

const STATUS_COLOR: Record<string, string> = {
  completed: colors.success,
  cancelled: colors.error,
  active: colors.interactiveBlue,
  pending: '#F59E0B',
}

function statusLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function ConsultationHistoryScreen() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const guardNav = useNavGuard()

  const [rows, setRows] = useState<ConsultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all')

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data } = await client
          .from('consultations')
          .select(`
            id, type, status, doctor_amount, started_at, scheduled_at, created_at, ended_at,
            patient:users!consultations_patient_id_fkey(full_name, profile_photo_url)
          `)
          .order('created_at', { ascending: false })

        if (data) {
          setRows((data as any[]).map((r) => ({
            id: r.id,
            type: r.type ?? 'chat',
            status: r.status,
            patientName: r.patient?.full_name ?? 'Patient',
            patientPhotoUrl: r.patient?.profile_photo_url ?? null,
            startedAt: r.started_at,
            scheduledAt: r.scheduled_at,
            createdAt: r.created_at,
            endedAt: r.ended_at,
            // Doctor's post-commission cut — matches the figure used by the
            // Consultations tab, website, and Withdraw balance.
            amount: Number(r.doctor_amount) || 0,
          })))
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.id])

  const filtered = rows.filter((r) => filter === 'all' || r.status === filter)

  const totalEarned = rows
    .filter((r) => r.status === 'completed')
    .reduce((s, r) => s + r.amount, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Consultation History</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tealGreen} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Stats banner */}
          <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.statsBanner}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rows.filter((r) => r.status === 'completed').length}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>ETB {totalEarned.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Total Earned</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rows.length}</Text>
              <Text style={styles.statLabel}>All Time</Text>
            </View>
          </LinearGradient>

          {/* Filter tabs */}
          <View style={styles.filterRow}>
            {(['all', 'completed', 'cancelled'] as const).map((f) => (
              <Pressable
                key={f}
                style={[styles.filterTab, filter === f && styles.filterTabActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="time-outline" size={48} color={colors.steelGrey} />
              <Text style={styles.emptyTitle}>No Consultations</Text>
              <Text style={styles.emptySub}>Your consultation history will appear here.</Text>
            </View>
          ) : (
            filtered.map((row) => (
              <Pressable
                key={row.id}
                style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.85 }]}
                onPress={row.status === 'completed'
                  ? guardNav(() => router.push({ pathname: '/(doctor)/consultation-summary' as any, params: { consultationId: row.id, patientName: row.patientName } }))
                  : undefined
                }
              >
                <View style={styles.rowLeft}>
                  {row.patientPhotoUrl ? (
                    <Image source={{ uri: row.patientPhotoUrl }} style={styles.rowAvatarPhoto} />
                  ) : (
                    <View style={styles.rowAvatarFallback}>
                      <Text style={styles.rowAvatarInitial}>{row.patientName.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.rowTypeBadge}>
                    <Ionicons name={(TYPE_ICONS[row.type] ?? 'chatbubble-ellipses') as any} size={10} color={colors.mistWhite} />
                  </View>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowPatient}>{row.patientName}</Text>
                  <Text style={styles.rowDate}>
                    {displayTimestamp(row)
                      ? new Date(displayTimestamp(row)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Not started'}
                    {displayDurationMinutes(row) !== null && ` · ${displayDurationMinutes(row)} min`}
                  </Text>
                  {row.status === 'completed' && (
                    <Text style={styles.viewSummaryHint}>Tap to view summary & prescription</Text>
                  )}
                </View>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowStatus, { color: STATUS_COLOR[row.status] ?? '#6B7280' }]}>
                    {statusLabel(row.status)}
                  </Text>
                  {row.status === 'completed' && (
                    <Text style={styles.rowAmount}>+ETB {row.amount}</Text>
                  )}
                  {row.status === 'completed' && (
                    <Ionicons name="chevron-forward" size={14} color={colors.steelGrey} />
                  )}
                </View>
              </Pressable>
            ))
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  statsBanner: { borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 16, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4) },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.25)' },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterTab: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.mistWhite, alignItems: 'center', borderWidth: 1, borderColor: colors.steelGrey },
  filterTabActive: { backgroundColor: colors.careBlue, borderColor: colors.careBlue },
  filterText: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  filterTextActive: { color: colors.mistWhite },

  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.inkBlack },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  rowCard: {
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  rowLeft: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  rowAvatarPhoto: { width: 42, height: 42, borderRadius: 12 },
  rowAvatarFallback: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center' },
  rowAvatarInitial: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  rowTypeBadge: {
    position: 'absolute', bottom: -3, right: -3, width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.steelGrey, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.mistWhite,
  },
  rowBody: { flex: 1 },
  rowPatient: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  rowDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowStatus: { fontFamily: fonts.semiBold, fontSize: 12 },
  rowAmount: { fontFamily: fonts.bold, fontSize: 13, color: colors.success },
  viewSummaryHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.careBlue, marginTop: 2 },
})
