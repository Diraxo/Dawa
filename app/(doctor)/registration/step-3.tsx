import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorStore } from '@/store/doctorStore'

interface UploadCardProps {
  title: string
  subtitle: string
  fileName: string | null
  loading: boolean
  onPick: () => void
  onRemove: () => void
}

function UploadCard({ title, subtitle, fileName, loading, onPick, onRemove }: UploadCardProps) {
  return (
    <View style={styles.uploadCard}>
      {fileName ? (
        <View style={styles.uploadedRow}>
          <View style={styles.uploadedIconWrap}>
            <Ionicons name="checkmark-circle" size={26} color={colors.success} />
          </View>
          <View style={styles.uploadedInfo}>
            <Text style={styles.uploadedTitle}>{title}</Text>
            <Text style={styles.uploadedFileName} numberOfLines={1}>{fileName}</Text>
          </View>
          <Pressable onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.error} />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onPick} style={styles.uploadTouchable}>
          <View style={styles.uploadIconWrap}>
            {loading ? (
              <ActivityIndicator color={colors.careBlue} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={28} color={colors.careBlue} />
            )}
          </View>
          <View style={styles.uploadTextWrap}>
            <Text style={styles.uploadTitle}>{title}</Text>
            <Text style={styles.uploadSubtitle}>{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Pressable>
      )}
    </View>
  )
}

export default function RegistrationStep3() {
  const router = useRouter()
  const store = useDoctorStore()

  const [licenseUri, setLicenseUri] = useState<string | null>(store.regLicenseDocUri)
  const [licenseName, setLicenseName] = useState<string | null>(store.regLicenseDocName)
  const [nationalIdUri, setNationalIdUri] = useState<string | null>(store.regNationalIdUri)
  const [nationalIdName, setNationalIdName] = useState<string | null>(store.regNationalIdName)
  const [licenseLoading, setLicenseLoading] = useState(false)
  const [idLoading, setIdLoading] = useState(false)

  const isValid = !!licenseUri && !!nationalIdUri

  const pickDocument = async (
    setUri: (v: string | null) => void,
    setName: (v: string | null) => void,
    setLoading: (v: boolean) => void
  ) => {
    setLoading(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true })
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0]
        setUri(asset.uri)
        setName(asset.name)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleNext = () => {
    store.updateReg({
      regLicenseDocUri: licenseUri,
      regLicenseDocName: licenseName,
      regNationalIdUri: nationalIdUri,
      regNationalIdName: nationalIdName,
    })
    router.push('/(doctor)/registration/step-4')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Top row */}
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.stepLabel}>Step 3 of 4</Text>
        </View>

        <Text style={styles.title}>Verify Your Identity</Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: '75%' }]} />
        </View>

        {/* Encryption note */}
        <View style={styles.encryptionNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.information} />
          <Text style={styles.encryptionText}>Your documents are encrypted and only reviewed by our admin team</Text>
        </View>

        {/* License Document */}
        <Text style={styles.sectionLabel}>Medical License Document</Text>
        <UploadCard
          title="Medical License"
          subtitle="Upload PDF or Image"
          fileName={licenseName}
          loading={licenseLoading}
          onPick={() => pickDocument(setLicenseUri, setLicenseName, setLicenseLoading)}
          onRemove={() => { setLicenseUri(null); setLicenseName(null) }}
        />

        {/* National ID */}
        <Text style={styles.sectionLabel}>National ID / Passport</Text>
        <UploadCard
          title="National ID / Passport"
          subtitle="Upload PDF or Image"
          fileName={nationalIdName}
          loading={idLoading}
          onPick={() => pickDocument(setNationalIdUri, setNationalIdName, setIdLoading)}
          onRemove={() => { setNationalIdUri(null); setNationalIdName(null) }}
        />

        {!isValid && (
          <View style={styles.reminderNote}>
            <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
            <Text style={styles.reminderText}>Both documents are required to proceed</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <View style={styles.backBtnWrap}>
            <OutlineButton label="← Back" onPress={() => router.back()} />
          </View>
          <View style={styles.nextBtnWrap}>
            <GradientButton label="Next →" onPress={handleNext} disabled={!isValid} />
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingHorizontal: 24, paddingTop: 12 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  stepLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 16 },

  progressTrack: { height: 6, backgroundColor: colors.cloudGrey, borderRadius: 3, marginBottom: 20, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  encryptionNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 24,
  },
  encryptionText: { fontFamily: fonts.regular, fontSize: 13, color: colors.information, flex: 1, lineHeight: 18 },

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 10 },

  uploadCard: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 16,
    backgroundColor: colors.mistWhite, marginBottom: 20,
    overflow: 'hidden',
  },
  uploadTouchable: {
    flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14,
    borderStyle: 'dashed',
  },
  uploadIconWrap: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
  },
  uploadTextWrap: { flex: 1 },
  uploadTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  uploadSubtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },

  uploadedRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  uploadedIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center' },
  uploadedInfo: { flex: 1 },
  uploadedTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  uploadedFileName: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  removeBtn: { padding: 4 },

  reminderNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  reminderText: { fontFamily: fonts.regular, fontSize: 13, color: colors.warning },

  footer: { paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  footerRow: { flexDirection: 'row', gap: 12 },
  backBtnWrap: { flex: 1 },
  nextBtnWrap: { flex: 2 },
})
