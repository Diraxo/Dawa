import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
// See app/(patient)/consultation-summary.tsx — this SDK moved
// writeAsStringAsync/EncodingType/documentDirectory behind /legacy.
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
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
import { formatDoctorName } from '@/lib/nameFormat'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

type ExportType = 'consultations' | 'documents' | 'all'

export default function DataExportScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [loading, setLoading] = useState<ExportType | null>(null)

  async function getUserId() {
    const token = await getToken()
    if (!token || !user) return null
    const client = getAuthClient(token)
    const { data } = await client.from('users').select('id').eq('clerk_id', user.id).single()
    return { token, userId: (data as any)?.id as string | undefined, client }
  }

  async function exportAndShare(filename: string, content: string, mimeType: string) {
    const path = `${FileSystem.documentDirectory}${filename}`
    await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 })
    const canShare = await Sharing.isAvailableAsync()
    if (canShare) {
      await Sharing.shareAsync(path, { mimeType, dialogTitle: `Save ${filename}` })
    } else {
      Alert.alert('File Saved', `Your export has been saved to:\n${path}`)
    }
  }

  async function exportConsultations() {
    setLoading('consultations')
    try {
      const auth = await getUserId()
      if (!auth?.userId || !auth.client) return

      const { data } = await auth.client
        .from('consultations')
        .select(`
          id, type, status, scheduled_at, started_at, ended_at, duration_minutes, patient_amount, created_at,
          doctor:doctor_profiles!doctor_id(user:users(full_name), specialty, hospital_name),
          consultation_summaries(chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed)
        `)
        .eq('patient_id', auth.userId)
        .order('created_at', { ascending: false })

      const rows = (data ?? []) as any[]
      const headers = 'ID,Type,Status,Doctor,Specialty,Date,Duration (min),Amount (ETB),Chief Complaint,Diagnosis'
      const csv = [
        headers,
        ...rows.map((r: any) => {
          const sum = r.consultation_summaries?.[0]
          return [
            r.id, r.type, r.status,
            r.doctor?.user?.full_name ? formatDoctorName(r.doctor.user.full_name) : '',
            r.doctor?.specialty ?? '',
            r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
            r.duration_minutes ?? '',
            r.patient_amount ?? '',
            sum?.chief_complaint ?? '',
            sum?.diagnosis ?? '',
          ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        }),
      ].join('\n')

      await exportAndShare(`dawa_consultations_${today()}.csv`, csv, 'text/csv')
    } catch {
      Alert.alert('Export Failed', 'Could not export consultations. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function exportAll() {
    setLoading('all')
    try {
      const auth = await getUserId()
      if (!auth?.userId || !auth.client) return

      const [{ data: consultations }, { data: files }] = await Promise.all([
        auth.client
          .from('consultations')
          .select(`
            id, type, status, scheduled_at, started_at, ended_at, duration_minutes, patient_amount, created_at,
            doctor:doctor_profiles!doctor_id(user:users(full_name), specialty, hospital_name),
            consultation_summaries(chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed)
          `)
          .eq('patient_id', auth.userId)
          .order('created_at', { ascending: false }),
        auth.client.storage.from('patient-documents').list(auth.userId),
      ])

      const exportData = {
        exported_at: new Date().toISOString(),
        patient_id: auth.userId,
        consultations: consultations ?? [],
        documents: (files ?? []).map((f: any) => ({ name: f.name, size: f.metadata?.size, created_at: f.created_at })),
      }

      await exportAndShare(`dawa_full_export_${today()}.json`, JSON.stringify(exportData, null, 2), 'application/json')
    } catch {
      Alert.alert('Export Failed', 'Could not export data. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  function today() { return new Date().toISOString().split('T')[0] }

  const items = [
    {
      id: 'consultations' as ExportType,
      icon: 'document-text',
      title: 'Consultation History',
      sub: 'CSV with all consultations, diagnoses, and prescriptions',
      action: exportConsultations,
      color: colors.careBlue,
    },
    {
      id: 'all' as ExportType,
      icon: 'archive',
      title: 'Full Data Export',
      sub: 'JSON with all medical data including documents list',
      action: exportAll,
      color: colors.tealGreen,
    },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Export My Data</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Download a copy of your medical history and records.</Text>

        {items.map(item => (
          <View key={item.id} style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: item.color + '18' }]}>
              <Ionicons name={item.icon as any} size={24} color={item.color} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSub}>{item.sub}</Text>
            </View>
            <Pressable
              onPress={item.action}
              disabled={loading !== null}
              style={({ pressed }) => [styles.exportBtn, { backgroundColor: item.color }, pressed && { opacity: 0.8 }, loading !== null && { opacity: 0.4 }]}
              accessibilityLabel={`Export ${item.title}`}
              accessibilityRole="button"
            >
              {loading === item.id ? (
                <ActivityIndicator size="small" color={colors.mistWhite} />
              ) : (
                <Ionicons name="download-outline" size={18} color={colors.mistWhite} />
              )}
            </Pressable>
          </View>
        ))}

        <View style={styles.privacyNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.careBlue} />
          <Text style={styles.privacyText}>
            Exports are generated locally and never sent to third parties. Your data is protected under our Privacy Policy.
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.mistWhite,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', marginBottom: 20, lineHeight: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16,
    marginBottom: 12, ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  iconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardBody: { flex: 1 },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 17 },
  exportBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12,
  },
  privacyText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.careBlue, lineHeight: 18 },
})
