import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
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

interface DocFile {
  label: string
  path: string
}

interface DocInfo {
  licenseFiles: DocFile[]
  idFiles: DocFile[]
  approvedAt: string | null
  status: string
}

export default function MyDocumentsScreen() {
  const { getToken } = useAuth()
  const router = useRouter()

  const [info, setInfo] = useState<DocInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingDoc, setOpeningDoc] = useState<string | null>(null)

  useEffect(() => {
    getToken().then(async (token) => {
      if (!token) { setLoading(false); return }
      const client = getAuthClient(token)
      const { data } = await client
        .from('doctor_profiles')
        .select('license_doc_url, id_doc_url, status, approved_at')
        .single()

      if (!data) { setLoading(false); return }

      const licenseFiles: DocFile[] = []
      const idFiles: DocFile[] = []

      // Parse license docs (JSON array of paths)
      const licenseRaw = (data as any).license_doc_url
      if (licenseRaw) {
        try {
          const paths: string[] = JSON.parse(licenseRaw)
          paths.forEach((path, i) => licenseFiles.push({ label: `License Document ${i + 1}`, path }))
        } catch {
          // Legacy: might be a plain string path
          licenseFiles.push({ label: 'License Document', path: licenseRaw })
        }
      }

      // Parse ID doc (JSON object with type + paths)
      const idRaw = (data as any).id_doc_url
      if (idRaw) {
        try {
          const parsed = JSON.parse(idRaw)
          if (parsed.type === 'national_id') {
            if (parsed.front) idFiles.push({ label: 'National ID — Front', path: parsed.front })
            if (parsed.back) idFiles.push({ label: 'National ID — Back', path: parsed.back })
          } else if (parsed.type === 'passport') {
            if (parsed.file) idFiles.push({ label: 'Passport', path: parsed.file })
          } else if (typeof parsed === 'string') {
            idFiles.push({ label: 'ID Document', path: parsed })
          }
        } catch {
          idFiles.push({ label: 'ID Document', path: idRaw })
        }
      }

      setInfo({
        licenseFiles,
        idFiles,
        approvedAt: (data as any).approved_at ?? null,
        status: (data as any).status ?? 'pending',
      })
      setLoading(false)
    })
  }, [])

  const openDocument = async (file: DocFile) => {
    setOpeningDoc(file.path)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const client = getAuthClient(token)
      const { data, error } = await client.storage
        .from('doctor-documents')
        .createSignedUrl(file.path, 3600)
      if (error || !data?.signedUrl) throw new Error('Could not generate document URL')
      await Linking.openURL(data.signedUrl)
    } catch {
      Alert.alert('Error', 'Could not open the document. Please try again.')
    } finally {
      setOpeningDoc(null)
    }
  }

  const requestUpdate = () => {
    Alert.alert(
      'Update Documents',
      'To update your documents, please contact support at support@dawa.app and attach your new documents.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Email Support', onPress: () => Linking.openURL('mailto:support@dawa.app?subject=Document%20Update%20Request') },
      ]
    )
  }

  const statusColor = info?.status === 'approved' ? colors.success : info?.status === 'rejected' ? colors.error : '#F59E0B'
  const statusLabel = info?.status === 'approved' ? 'Approved' : info?.status === 'rejected' ? 'Rejected' : 'Under Review'

  const renderDocFile = (file: DocFile, accentColor: string) => {
    const isOpening = openingDoc === file.path
    return (
      <Pressable
        key={file.path}
        style={({ pressed }) => [styles.docCard, pressed && { opacity: 0.85 }]}
        onPress={() => openDocument(file)}
        disabled={isOpening}
      >
        <LinearGradient colors={[`${accentColor}18`, `${accentColor}08`]} style={styles.docIconWrap}>
          {isOpening
            ? <ActivityIndicator color={accentColor} size="small" />
            : <Ionicons name="document-text" size={28} color={accentColor} />}
        </LinearGradient>
        <View style={styles.docInfo}>
          <Text style={styles.docTitle}>{file.label}</Text>
          <Text style={styles.docStatus}>Uploaded · Tap to view</Text>
        </View>
        <Ionicons name="open-outline" size={20} color="#9CA3AF" />
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>My Documents</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tealGreen} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Status banner */}
          <View style={[styles.statusBanner, { borderColor: statusColor + '44' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
              {info?.approvedAt && (
                <Text style={styles.approvedDate}>
                  Approved on {new Date(info.approvedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
            </View>
          </View>

          {/* License Documents */}
          <Text style={styles.sectionLabel}>Medical License</Text>
          {info && info.licenseFiles.length > 0 ? (
            info.licenseFiles.map((file) => renderDocFile(file, colors.careBlue))
          ) : (
            <View style={styles.docCard}>
              <LinearGradient colors={[`${colors.careBlue}18`, `${colors.careBlue}08`]} style={styles.docIconWrap}>
                <Ionicons name="document-text" size={28} color={colors.careBlue} />
              </LinearGradient>
              <View style={styles.docInfo}>
                <Text style={styles.docTitle}>Medical License</Text>
                <Text style={[styles.docStatus, { color: '#F59E0B' }]}>Not uploaded</Text>
              </View>
              <Ionicons name="cloud-upload-outline" size={20} color="#9CA3AF" />
            </View>
          )}

          {/* ID Documents */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Government ID</Text>
          {info && info.idFiles.length > 0 ? (
            info.idFiles.map((file) => renderDocFile(file, colors.tealGreen))
          ) : (
            <View style={styles.docCard}>
              <LinearGradient colors={[`${colors.tealGreen}18`, `${colors.tealGreen}08`]} style={styles.docIconWrap}>
                <Ionicons name="card" size={28} color={colors.tealGreen} />
              </LinearGradient>
              <View style={styles.docInfo}>
                <Text style={styles.docTitle}>Government ID</Text>
                <Text style={[styles.docStatus, { color: '#9CA3AF' }]}>Not provided (optional)</Text>
              </View>
              <Ionicons name="cloud-upload-outline" size={20} color="#9CA3AF" />
            </View>
          )}

          {/* Update notice */}
          <View style={styles.noticeCard}>
            <Ionicons name="information-circle-outline" size={20} color={colors.information} />
            <Text style={styles.noticeText}>
              To update your documents, contact our support team. Document changes require admin re-verification.
            </Text>
          </View>

          <Pressable style={({ pressed }) => [styles.updateBtn, pressed && { opacity: 0.85 }]} onPress={requestUpdate}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.updateGrad}>
              <Ionicons name="mail-outline" size={20} color={colors.mistWhite} />
              <Text style={styles.updateText}>Request Document Update</Text>
            </LinearGradient>
          </Pressable>

          <View style={{ height: 40 }} />
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

  statusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 14, marginBottom: 20,
    borderWidth: 1, ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontFamily: fonts.bold, fontSize: 15 },
  approvedDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginLeft: 4 },

  docCard: {
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  docIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  docInfo: { flex: 1 },
  docTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, marginBottom: 3 },
  docStatus: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },

  noticeCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 16, marginTop: 12,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  noticeText: { fontFamily: fonts.regular, fontSize: 13, color: '#1E40AF', flex: 1, lineHeight: 18 },

  updateBtn: { borderRadius: 14, overflow: 'hidden' },
  updateGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16,
  },
  updateText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.mistWhite },
})
