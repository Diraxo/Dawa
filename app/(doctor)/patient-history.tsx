import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
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

interface HistoryEntry {
  consultationId: string
  type: 'chat' | 'phone' | 'video'
  date: string
  chiefComplaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup: string | null
  referralNeeded: boolean
  durationMinutes: number | null
}

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubble-ellipses', phone: 'call', video: 'videocam',
}

export default function DoctorPatientHistoryScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { patientId, patientName, consultationId } = useLocalSearchParams<{
    patientId: string
    patientName?: string
    consultationId?: string
  }>()

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!patientId && !consultationId) { setLoading(false); return }
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        // When a specific consultationId is passed (e.g. tapping "History" on
        // one card in the Consultations list), scope the query to that single
        // consultation so different cards for the same patient don't all show
        // the same full history. Otherwise fall back to the original
        // full-patient-history behavior used by other entry points (e.g. the
        // chat consultation "View History" action) that only pass patientId.
        let query = getAuthClient(token)
          .from('consultations')
          .select(`
            id, type, ended_at, duration_minutes,
            consultation_summaries!inner(
              chief_complaint, diagnosis, prescription,
              followup_recommendation, referral_needed
            )
          `)

        query = consultationId
          ? query.eq('id', consultationId)
          : query.eq('patient_id', patientId).eq('status', 'completed')

        const { data } = await query
          .order('ended_at', { ascending: false })
          .limit(50)

        if (data) {
          setHistory((data as any[]).map(r => {
            const s = Array.isArray(r.consultation_summaries) ? r.consultation_summaries[0] : r.consultation_summaries
            return {
              consultationId: r.id,
              type: r.type ?? 'chat',
              date: r.ended_at,
              chiefComplaint: s?.chief_complaint ?? null,
              diagnosis: s?.diagnosis ?? null,
              prescription: s?.prescription ?? null,
              followup: s?.followup_recommendation ?? null,
              referralNeeded: s?.referral_needed ?? false,
              durationMinutes: r.duration_minutes ?? null,
            }
          }))
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    })()
  }, [patientId, consultationId])

  const parsePrescription = (raw: string | null): Array<{ medicine: string; dosage: string; duration: string }> => {
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{patientName ?? 'Patient'}</Text>
          <Text style={styles.headerSub}>Medical History</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.tealGreen} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={52} color={colors.steelGrey} />
          <Text style={styles.emptyTitle}>No History Yet</Text>
          <Text style={styles.emptySub}>Past consultations with summaries will appear here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={gradients.hero} style={styles.statsBanner}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{history.length}</Text>
              <Text style={styles.statLabel}>Consultations</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{history.filter(h => h.referralNeeded).length}</Text>
              <Text style={styles.statLabel}>Referrals</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{history.filter(h => h.prescription).length}</Text>
              <Text style={styles.statLabel}>Prescriptions</Text>
            </View>
          </LinearGradient>

          {history.map((entry) => {
            const isExpanded = expanded === entry.consultationId
            const rxList = parsePrescription(entry.prescription)
            return (
              <Pressable
                key={entry.consultationId}
                style={styles.entryCard}
                onPress={() => setExpanded(isExpanded ? null : entry.consultationId)}
              >
                <View style={styles.entryHeader}>
                  <View style={styles.typeIcon}>
                    <Ionicons name={TYPE_ICONS[entry.type] ?? 'chatbubble-ellipses'} size={18} color={colors.inkBlack} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryDate}>
                      {entry.date
                        ? new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Unknown date'}
                      {entry.durationMinutes ? ` · ${entry.durationMinutes} min` : ''}
                    </Text>
                    <Text style={styles.entryComplaint} numberOfLines={isExpanded ? undefined : 1}>
                      {entry.chiefComplaint ?? 'No complaint recorded'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {entry.referralNeeded && (
                      <View style={styles.referralDot} />
                    )}
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.steelGrey} />
                  </View>
                </View>

                {isExpanded && (
                  <View style={styles.entryBody}>
                    <DetailRow label="Diagnosis" value={entry.diagnosis ?? 'Not recorded'} />
                    {entry.followup ? <DetailRow label="Follow-up" value={entry.followup} /> : null}
                    {entry.referralNeeded && (
                      <View style={styles.referralBadge}>
                        <Ionicons name="arrow-forward-circle" size={14} color={colors.careBlue} />
                        <Text style={styles.referralBadgeText}>Specialist referral recommended</Text>
                      </View>
                    )}
                    {rxList.length > 0 && (
                      <View style={styles.rxSection}>
                        <Text style={styles.rxSectionTitle}>Prescription</Text>
                        {rxList.map((rx, i) => (
                          <View key={i} style={styles.rxItem}>
                            <Text style={styles.rxMedicine}>{rx.medicine}</Text>
                            {(rx.dosage || rx.duration) ? (
                              <Text style={styles.rxDetail}>{rx.dosage}{rx.duration ? ' · ' + rx.duration : ''}</Text>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </Pressable>
            )
          })}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={detailStyles.value}>{value}</Text>
    </View>
  )
}

const detailStyles = StyleSheet.create({
  row: { marginBottom: 10 },
  label: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.careBlue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  value: { fontFamily: fonts.regular, fontSize: 13, color: '#374151', lineHeight: 20 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.mistWhite, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack },
  headerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.inkBlack },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  statsBanner: {
    borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    marginBottom: 16, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4),
  },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.25)' },

  entryCard: {
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 10,
    ...shadow('#000', 0, 1, 4, 0.05, 1),
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  entryDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  entryComplaint: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginTop: 2 },
  referralDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.careBlue },

  entryBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  referralBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 8,
  },
  referralBadgeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.careBlue },

  rxSection: { marginTop: 4 },
  rxSectionTitle: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.tealGreen, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  rxItem: { marginBottom: 6 },
  rxMedicine: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack },
  rxDetail: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 1 },
})
