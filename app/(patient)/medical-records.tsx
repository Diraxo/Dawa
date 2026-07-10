import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { LinearGradient } from 'expo-linear-gradient'
import * as Sharing from 'expo-sharing'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { validatePickedFile, safeFilename } from '@/lib/fileValidation'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordCategory = 'all' | 'prescription' | 'summary' | 'document' | 'lab_report'

interface MedicalRecord {
  id: string
  title: string
  category: RecordCategory
  date: string
  doctor: string
  fileType: 'pdf' | 'image' | 'text'
  detail: string
  storagePath?: string
}

const FILE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  pdf: 'document-text',
  image: 'image',
  text: 'clipboard',
}

const CATEGORY_COLORS: Record<RecordCategory, string> = {
  all: colors.tealGreen,
  prescription: colors.tealGreen,
  summary: '#7C3AED',
  document: colors.careBlue,
  lab_report: '#D97706',
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MedicalRecordsScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { user } = useUser()
  const { getToken } = useAuth()
  const [active, setActive] = useState<RecordCategory>('all')

  const CATEGORIES: { key: RecordCategory; label: string }[] = [
    { key: 'all',          label: t('allRecords') },
    { key: 'summary',      label: t('summaryRecords') },
    { key: 'prescription', label: t('prescriptionRecords') },
    { key: 'lab_report',   label: 'Lab Reports' },
    { key: 'document',     label: t('myDocuments') },
  ]
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null)
  const [previewRecord, setPreviewRecord] = useState<MedicalRecord | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const token = await getToken()
        const client = token ? getAuthClient(token) : supabase

        const { data: userData } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', user.id)
          .maybeSingle()
        if (!userData) return
        setSupabaseUserId((userData as any).id)

        const { data: summaries } = await client
          .from('consultation_summaries')
          .select(`
            id, diagnosis, prescription, chief_complaint, followup_recommendation, created_at,
            consultation:consultations!inner(
              patient_id,
              doctor:doctor_profiles!doctor_id(user:users(full_name))
            )
          `)
          .eq('consultation.patient_id', (userData as any).id)
          .order('created_at', { ascending: false })

        const result: MedicalRecord[] = []
        for (const s of (summaries ?? []) as any[]) {
          const doctorName = s.consultation?.doctor?.user?.full_name ?? 'Doctor'
          const date = new Date(s.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })
          result.push({
            id: s.id,
            title: s.diagnosis ? `Consultation — ${s.diagnosis}` : 'Consultation Summary',
            category: 'summary',
            date,
            doctor: doctorName,
            fileType: 'text',
            detail: [
              s.chief_complaint && `Complaint: ${s.chief_complaint}`,
              s.diagnosis && `Diagnosis: ${s.diagnosis}`,
              s.followup_recommendation && `Follow-up: ${s.followup_recommendation}`,
            ].filter(Boolean).join('\n'),
          })
          if (s.prescription) {
            result.push({
              id: `${s.id}-rx`,
              title: 'Prescription',
              category: 'prescription',
              date,
              doctor: doctorName,
              fileType: 'text',
              detail: s.prescription,
            })
          }
        }

        // Load uploaded documents from storage
        if (token) {
          const authClient = getAuthClient(token)
          const { data: files } = await authClient.storage
            .from('patient-documents')
            .list((userData as any).id, { sortBy: { column: 'created_at', order: 'desc' } })
          for (const file of (files ?? [])) {
            const isPdf = file.name.toLowerCase().endsWith('.pdf')
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
            const isLabReport = file.name.startsWith('lab_report_')
            const displayName = isLabReport ? file.name.replace(/^lab_report_\d+_/, '') : file.name
            result.push({
              id: `doc-${file.id}`,
              title: displayName,
              category: isLabReport ? 'lab_report' : 'document',
              date: new Date(file.created_at ?? Date.now()).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              }),
              doctor: t('uploadedByYou'),
              fileType: isPdf ? 'pdf' : isImage ? 'image' : 'text',
              detail: '',
              storagePath: `${(userData as any).id}/${file.name}`,
            })
          }
        }

        setRecords(result)
      } finally {
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const filtered = active === 'all' ? records : records.filter((r) => r.category === active)

  const doUpload = async (isLabReport: boolean) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.length) return
      const file = result.assets[0]

      if (!supabaseUserId) { Alert.alert(t('error'), t('userNotFound')); return }
      const token = await getToken()
      if (!token) { Alert.alert(t('error'), t('authFailed')); return }

      // Validate file before uploading
      const validation = validatePickedFile({ name: file.name, mimeType: file.mimeType, size: file.size })
      if (!validation.valid) { Alert.alert(t('invalidFile'), validation.error ?? t('tryAgain')); return }

      setUploading(true)
      const fileBytes = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 })
      const arrayBuffer = Uint8Array.from(atob(fileBytes), c => c.charCodeAt(0))
      const prefix = isLabReport ? 'lab_report_' : ''
      const safeName = safeFilename(file.name, prefix)
      const path = `${supabaseUserId}/${safeName}`

      const { error: uploadError } = await getAuthClient(token)
        .storage
        .from('patient-documents')
        .upload(path, arrayBuffer, { contentType: file.mimeType ?? 'application/octet-stream', upsert: false })

      if (uploadError) throw uploadError

      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
      const newRecord: MedicalRecord = {
        id: `doc-${path}`,
        title: file.name,
        category: isLabReport ? 'lab_report' : 'document',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        doctor: t('uploadedByYou'),
        fileType: isPdf ? 'pdf' : isImage ? 'image' : 'text',
        detail: '',
        storagePath: path,
      }
      setRecords(prev => [newRecord, ...prev])
      Alert.alert(t('uploaded'), `${file.name} ${t('uploadedSuccessfully')}`)
    } catch (err: any) {
      Alert.alert(t('uploadFailed'), err?.message ?? t('tryAgain'))
    } finally {
      setUploading(false)
    }
  }

  const handleUpload = () => {
    Alert.alert(
      'Upload Document',
      'What type of document are you uploading?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lab Report', onPress: () => doUpload(true) },
        { text: 'General Document', onPress: () => doUpload(false) },
      ],
    )
  }

  const handleOpen = async (record: MedicalRecord) => {
    if (record.fileType === 'text' || !record.storagePath) {
      setPreviewRecord(record)
      setPreviewImageUrl(null)
      return
    }
    setPreviewLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const { data } = await getAuthClient(token).storage
        .from('patient-documents')
        .createSignedUrl(record.storagePath, 3600)
      if (!data?.signedUrl) { Alert.alert(t('error'), t('couldNotOpenFile')); return }
      if (record.fileType === 'image') {
        setPreviewRecord(record)
        setPreviewImageUrl(data.signedUrl)
      } else {
        await Linking.openURL(data.signedUrl)
      }
    } catch {
      Alert.alert(t('error'), t('couldNotOpenFile'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDownload = async (record: MedicalRecord) => {
    if (!record.storagePath) return
    setDownloading(true)
    try {
      const token = await getToken()
      if (!token) return
      const { data } = await getAuthClient(token).storage
        .from('patient-documents')
        .createSignedUrl(record.storagePath, 300)
      if (!data?.signedUrl) { Alert.alert(t('error'), t('couldNotOpenFile')); return }
      const filename = record.storagePath.split('/').pop() ?? 'file'
      const localUri = `${FileSystem.documentDirectory}${filename}`
      await FileSystem.downloadAsync(data.signedUrl, localUri)
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, { dialogTitle: record.title })
      } else {
        Alert.alert(t('downloaded'), localUri)
      }
    } catch (err: any) {
      Alert.alert(t('error'), err?.message ?? t('tryAgain'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
    {/* Record preview modal */}
    <Modal
      visible={!!previewRecord}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { setPreviewRecord(null); setPreviewImageUrl(null) }}
    >
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={2}>{previewRecord?.title ?? ''}</Text>
          <Pressable
            onPress={() => { setPreviewRecord(null); setPreviewImageUrl(null) }}
            style={styles.modalClose}
            hitSlop={10}
          >
            <Ionicons name="close" size={22} color={colors.inkBlack} />
          </Pressable>
        </View>
        <Text style={styles.modalMeta}>{previewRecord?.doctor}  ·  {previewRecord?.date}</Text>

        {previewImageUrl ? (
          <View style={styles.modalImageWrap}>
            <Image
              source={{ uri: previewImageUrl }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          </View>
        ) : (
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalDetailText}>
              {previewRecord?.detail || t('noDetails')}
            </Text>
          </ScrollView>
        )}

        {previewRecord?.storagePath && (
          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.8 }]}
              onPress={() => previewRecord && handleDownload(previewRecord)}
              disabled={downloading}
            >
              {downloading
                ? <ActivityIndicator color={colors.mistWhite} size="small" />
                : <Ionicons name="download-outline" size={18} color={colors.mistWhite} />
              }
              <Text style={styles.downloadBtnText}>
                {downloading ? t('downloading') : t('download')}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>

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
        <Text style={styles.headerTitle}>{t('medicalRecords')}</Text>
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
        {loading ? (
          <ActivityIndicator color={colors.careBlue} style={{ marginTop: 60 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="folder-open-outline" size={52} color={colors.steelGrey} />
            <Text style={styles.emptyTitle}>{t('noRecordsYet')}</Text>
            <Text style={styles.emptySub}>{t('noRecordsDesc')}</Text>
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
                    {record.category === 'lab_report' ? 'Lab Report' : record.category}
                  </Text>
                </View>
                {record.storagePath ? (
                  <Pressable
                    hitSlop={8}
                    onPress={(e) => { e.stopPropagation?.(); handleDownload(record) }}
                    style={({ pressed }) => [styles.dlIconBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="download-outline" size={18} color={colors.careBlue} />
                  </Pressable>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={colors.steelGrey} />
                )}
              </View>
            </Pressable>
          ))
        )}

        {/* Upload card */}
        <Pressable
          style={({ pressed }) => [styles.uploadCard, pressed && { opacity: 0.88 }]}
          onPress={handleUpload}
          disabled={uploading}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.uploadGrad}
          >
            {uploading
              ? <ActivityIndicator color={colors.mistWhite} size="small" />
              : <Ionicons name="cloud-upload-outline" size={22} color={colors.mistWhite} />
            }
            <Text style={styles.uploadText}>
              {uploading ? t('uploading') : t('uploadNewDocument')}
            </Text>
          </LinearGradient>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
    </>
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
    ...shadow('#000', 0, 1, 5, 0.05, 2),
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

  dlIconBtn: { padding: 4 },

  // Modal styles
  modalSafe: { flex: 1, backgroundColor: colors.mistWhite },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, gap: 12,
  },
  modalTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack, lineHeight: 24 },
  modalClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalMeta: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', paddingHorizontal: 20, marginBottom: 12 },
  modalScroll: { flex: 1 },
  modalContent: { paddingHorizontal: 20, paddingBottom: 24 },
  modalDetailText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack, lineHeight: 24 },
  modalImageWrap: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  modalImage: { flex: 1, borderRadius: 12 },
  modalFooter: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.tealGreen, borderRadius: 14, height: 48,
  },
  downloadBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
})
