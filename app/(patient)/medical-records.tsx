import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
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

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordCategory = 'all' | 'lab' | 'prescription' | 'imaging' | 'summary'

interface MedicalRecord {
  id: string
  title: string
  category: RecordCategory
  date: string
  doctor: string
  fileType: 'pdf' | 'image' | 'text'
}

// ─── Mock data — replace with Supabase query when ready ──────────────────────
// supabase.from('consultation_summaries').select('*').eq('patient_id', userId)

const MOCK_RECORDS: MedicalRecord[] = [
  {
    id: '1',
    title: 'Blood Test Results',
    category: 'lab',
    date: 'Dec 10, 2025',
    doctor: 'Dr. Eleni Tesfaye',
    fileType: 'pdf',
  },
  {
    id: '2',
    title: 'Prescription — Antibiotics',
    category: 'prescription',
    date: 'Nov 28, 2025',
    doctor: 'Dr. Jean-Pierre Nshimiye',
    fileType: 'pdf',
  },
  {
    id: '3',
    title: 'Chest X-Ray',
    category: 'imaging',
    date: 'Oct 15, 2025',
    doctor: 'Dr. Samuel Bekele',
    fileType: 'image',
  },
  {
    id: '4',
    title: 'Consultation Summary',
    category: 'summary',
    date: 'Sep 3, 2025',
    doctor: 'Dr. Fatima Al-Rashid',
    fileType: 'text',
  },
]

const CATEGORIES: { key: RecordCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lab', label: 'Lab' },
  { key: 'prescription', label: 'Prescription' },
  { key: 'imaging', label: 'Imaging' },
  { key: 'summary', label: 'Summary' },
]

const FILE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  pdf: 'document-text',
  image: 'image',
  text: 'clipboard',
}

const CATEGORY_COLORS: Record<RecordCategory, string> = {
  all: colors.tealGreen,
  lab: '#0288D1',
  prescription: colors.tealGreen,
  imaging: colors.interactiveBlue,
  summary: '#7C3AED',
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MedicalRecordsScreen() {
  const router = useRouter()
  const [active, setActive] = useState<RecordCategory>('all')

  const filtered =
    active === 'all' ? MOCK_RECORDS : MOCK_RECORDS.filter((r) => r.category === active)

  const handleUpload = () => {
    Alert.alert(
      'Upload Document',
      'Add expo-document-picker to enable file uploads.',
      [{ text: 'OK' }]
    )
  }

  const handleOpen = (record: MedicalRecord) => {
    Alert.alert(record.title, `Doctor: ${record.doctor}\nDate: ${record.date}`, [
      { text: 'Close' },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Medical Records</Text>
        <Pressable
          onPress={handleUpload}
          style={({ pressed }) => [styles.uploadIconBtn, pressed && { opacity: 0.7 }]}
          hitSlop={10}
        >
          <Ionicons name="cloud-upload-outline" size={24} color={colors.tealGreen} />
        </Pressable>
      </View>

      {/* Category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat.key}
            style={[styles.filterChip, active === cat.key && styles.filterChipActive]}
            onPress={() => setActive(cat.key)}
          >
            {active === cat.key ? (
              <LinearGradient
                colors={gradients.interactive}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.filterChipGrad}
              >
                <Text style={[styles.filterText, styles.filterTextActive]}>
                  {cat.label}
                </Text>
              </LinearGradient>
            ) : (
              <Text style={styles.filterText}>{cat.label}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="folder-open-outline" size={52} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>No records found</Text>
            <Text style={styles.emptySub}>Upload your first document using the button above.</Text>
          </View>
        ) : (
          filtered.map((record) => (
            <Pressable
              key={record.id}
              style={({ pressed }) => [styles.recordCard, pressed && { opacity: 0.88 }]}
              onPress={() => handleOpen(record)}
            >
              <View
                style={[
                  styles.recordIconWrap,
                  { backgroundColor: `${CATEGORY_COLORS[record.category]}18` },
                ]}
              >
                <Ionicons
                  name={FILE_ICONS[record.fileType]}
                  size={26}
                  color={CATEGORY_COLORS[record.category]}
                />
              </View>
              <View style={styles.recordInfo}>
                <Text style={styles.recordTitle}>{record.title}</Text>
                <Text style={styles.recordMeta}>{record.doctor}</Text>
                <Text style={styles.recordDate}>{record.date}</Text>
              </View>
              <View style={styles.recordActions}>
                <View
                  style={[
                    styles.categoryBadge,
                    { backgroundColor: `${CATEGORY_COLORS[record.category]}18` },
                  ]}
                >
                  <Text
                    style={[styles.categoryBadgeText, { color: CATEGORY_COLORS[record.category] }]}
                  >
                    {record.category}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.steelGrey} />
              </View>
            </Pressable>
          ))
        )}

        {/* Upload card */}
        <Pressable
          style={({ pressed }) => [styles.uploadCard, pressed && { opacity: 0.88 }]}
          onPress={handleUpload}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.uploadGrad}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.mistWhite} />
            <Text style={styles.uploadText}>Upload New Document</Text>
          </LinearGradient>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  uploadIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  filterRow: { paddingHorizontal: 20, paddingBottom: 14, gap: 8 },
  filterChip: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.mistWhite,
    borderWidth: 1,
    borderColor: colors.steelGrey,
  },
  filterChipActive: { borderColor: 'transparent' },
  filterChipGrad: { paddingHorizontal: 16, paddingVertical: 8 },
  filterText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterTextActive: {
    color: colors.mistWhite,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },

  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.inkBlack },
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },

  recordCard: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  recordIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInfo: { flex: 1 },
  recordTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, marginBottom: 2 },
  recordMeta: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 2 },
  recordDate: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },
  recordActions: { alignItems: 'flex-end', gap: 8 },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  categoryBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, textTransform: 'capitalize' },

  uploadCard: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  uploadGrad: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  uploadText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
})
