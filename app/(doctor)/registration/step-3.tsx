import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorStore } from '@/store/doctorStore'

type IdDocType = 'national_id' | 'passport'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileIcon(name: string, uri: string): 'image' | 'document-text' {
  if (uri.startsWith('data:image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return 'image'
  return 'document-text'
}

// ─── Web + native file picker ─────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

async function pickFile(): Promise<{ uri: string; name: string } | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      let resolved = false

      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,.pdf'

      input.onchange = (e: Event) => {
        resolved = true
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) { resolve(null); return }
        if (file.size > MAX_FILE_SIZE) {
          Alert.alert('File Too Large', 'Please choose a file under 10 MB.')
          resolve(null); return
        }
        const reader = new FileReader()
        reader.onload = (ev) => resolve({ uri: ev.target?.result as string, name: file.name })
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      }

      // Resolve null when user cancels the dialog (window regains focus)
      const onFocus = () => {
        setTimeout(() => {
          if (!resolved) { resolved = true; resolve(null) }
        }, 300)
      }
      window.addEventListener('focus', onFocus, { once: true })

      input.click()
    })
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
  })
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  if (asset.size && asset.size > MAX_FILE_SIZE) {
    Alert.alert('File Too Large', 'Please choose a file under 10 MB.')
    return null
  }
  return { uri: asset.uri, name: asset.name }
}

// ─── UploadCard ───────────────────────────────────────────────────────────────

function UploadCard({
  title, subtitle, fileName, fileUri, loading, onPick, onRemove,
}: {
  title: string; subtitle: string; fileName: string | null; fileUri: string | null
  loading: boolean; onPick: () => void; onRemove: () => void
}) {
  return (
    <View style={styles.uploadCard}>
      {fileName ? (
        <View style={styles.uploadedRow}>
          <View style={styles.uploadedIconWrap}>
            <Ionicons name={fileIcon(fileName, fileUri ?? '')} size={22} color={colors.success} />
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RegistrationStep3() {
  const router = useRouter()
  const store = useDoctorStore()
  const { t } = useTranslation()

  // License
  const [licenseUris, setLicenseUris] = useState<string[]>(store.regLicenseDocUris)
  const [licenseNames, setLicenseNames] = useState<string[]>(store.regLicenseDocNames)
  const [licenseLoading, setLicenseLoading] = useState(false)

  // National ID / Passport — optional
  const [idDocType, setIdDocType] = useState<IdDocType | null>(store.regIdDocType)
  const [idFrontUri, setIdFrontUri] = useState<string | null>(store.regNationalIdFrontUri)
  const [idFrontName, setIdFrontName] = useState<string | null>(store.regNationalIdFrontName)
  const [idBackUri, setIdBackUri] = useState<string | null>(store.regNationalIdBackUri)
  const [idBackName, setIdBackName] = useState<string | null>(store.regNationalIdBackName)
  const [idFrontLoading, setIdFrontLoading] = useState(false)
  const [idBackLoading, setIdBackLoading] = useState(false)

  // If they switch ID type, clear previous uploads
  const switchIdType = (type: IdDocType) => {
    if (idDocType === type) return
    setIdDocType(type)
    setIdFrontUri(null); setIdFrontName(null)
    setIdBackUri(null); setIdBackName(null)
  }

  // isValid: license required; if ID type selected, enforce completeness
  const idComplete =
    idDocType === null ||
    (idDocType === 'national_id' && !!idFrontUri && !!idBackUri) ||
    (idDocType === 'passport' && !!idFrontUri)

  const isValid = licenseUris.length > 0 && idComplete

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAddLicense = async () => {
    setLicenseLoading(true)
    try {
      const file = await pickFile()
      if (file) {
        setLicenseUris((prev) => [...prev, file.uri])
        setLicenseNames((prev) => [...prev, file.name])
      }
    } finally {
      setLicenseLoading(false)
    }
  }

  const handleRemoveLicense = (index: number) => {
    setLicenseUris((prev) => prev.filter((_, i) => i !== index))
    setLicenseNames((prev) => prev.filter((_, i) => i !== index))
  }

  const handlePickIdFront = async () => {
    setIdFrontLoading(true)
    try {
      const file = await pickFile()
      if (file) { setIdFrontUri(file.uri); setIdFrontName(file.name) }
    } finally {
      setIdFrontLoading(false)
    }
  }

  const handlePickIdBack = async () => {
    setIdBackLoading(true)
    try {
      const file = await pickFile()
      if (file) { setIdBackUri(file.uri); setIdBackName(file.name) }
    } finally {
      setIdBackLoading(false)
    }
  }

  const handleNext = () => {
    store.updateReg({
      regLicenseDocUris: licenseUris,
      regLicenseDocNames: licenseNames,
      regIdDocType: idDocType,
      regNationalIdFrontUri: idFrontUri,
      regNationalIdFrontName: idFrontName,
      regNationalIdBackUri: idDocType === 'national_id' ? idBackUri : null,
      regNationalIdBackName: idDocType === 'national_id' ? idBackName : null,
    })
    router.push('/(doctor)/registration/step-4')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

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

        <Text style={styles.title}>{t('verifyYourIdentity')}</Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: '75%' }]} />
        </View>

        {/* Encryption note */}
        <View style={styles.encryptionNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.information} />
          <Text style={styles.encryptionText}>{t('documentsEncryptedNote')}</Text>
        </View>

        {/* ── Medical License (required) ── */}
        <Text style={styles.sectionLabel}>{t('medicalLicenseDocument')}</Text>
        <Text style={styles.sectionHint}>{t('uploadLicenseHint')}</Text>

        {licenseNames.map((name, i) => (
          <View key={i} style={styles.uploadCard}>
            <View style={styles.uploadedRow}>
              <View style={styles.uploadedIconWrap}>
                <Ionicons name={fileIcon(name, licenseUris[i])} size={22} color={colors.success} />
              </View>
              <View style={styles.uploadedInfo}>
                <Text style={styles.uploadedTitle}>{t('document')} {i + 1}</Text>
                <Text style={styles.uploadedFileName} numberOfLines={1}>{name}</Text>
              </View>
              <Pressable onPress={() => handleRemoveLicense(i)} style={styles.removeBtn} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable onPress={handleAddLicense} disabled={licenseLoading} style={styles.addDocBtn}>
          {licenseLoading
            ? <ActivityIndicator color={colors.careBlue} size="small" />
            : <Ionicons name="add-circle-outline" size={20} color={colors.careBlue} />}
          <Text style={styles.addDocText}>
            {licenseUris.length === 0 ? t('uploadMedicalLicense') : t('addAnotherDocument')}
          </Text>
        </Pressable>

        {/* ── National ID / Passport (optional) ── */}
        <View style={styles.idSectionHeader}>
          <Text style={styles.sectionLabel}>{t('idDocument')}</Text>
          <View style={styles.optionalBadge}>
            <Text style={styles.optionalText}>{t('optional')}</Text>
          </View>
        </View>

        {/* Type toggle */}
        <View style={styles.idTypeRow}>
          {(['national_id', 'passport'] as const).map((type) => {
            const label = type === 'national_id' ? t('nationalId') : t('passportDoc')
            const selected = idDocType === type
            return (
              <Pressable key={type} onPress={() => switchIdType(type)} style={styles.idTypeChipWrap}>
                {selected ? (
                  <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.idTypeChip}>
                    <Text style={[styles.idTypeText, { color: colors.mistWhite }]}>{label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.idTypeChip, styles.idTypeChipUnselected]}>
                    <Text style={styles.idTypeText}>{label}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>

        {/* National ID — front + back */}
        {idDocType === 'national_id' && (
          <>
            <View style={styles.idNote}>
              <Ionicons name="information-circle-outline" size={15} color={colors.information} />
              <Text style={styles.idNoteText}>{t('uploadBothSidesNote')}</Text>
            </View>
            <Text style={styles.subLabel}>{t('frontSide')}</Text>
            <UploadCard
              title={t('nationalIdFront')}
              subtitle={t('pdfOrImage')}
              fileName={idFrontName}
              fileUri={idFrontUri}
              loading={idFrontLoading}
              onPick={handlePickIdFront}
              onRemove={() => { setIdFrontUri(null); setIdFrontName(null) }}
            />
            <Text style={styles.subLabel}>{t('backSide')}</Text>
            <UploadCard
              title={t('nationalIdBack')}
              subtitle={t('pdfOrImage')}
              fileName={idBackName}
              fileUri={idBackUri}
              loading={idBackLoading}
              onPick={handlePickIdBack}
              onRemove={() => { setIdBackUri(null); setIdBackName(null) }}
            />
          </>
        )}

        {/* Passport — single file */}
        {idDocType === 'passport' && (
          <>
            <View style={styles.idNote}>
              <Ionicons name="information-circle-outline" size={15} color={colors.information} />
              <Text style={styles.idNoteText}>{t('uploadPassportNote')}</Text>
            </View>
            <UploadCard
              title={t('passportPhotoPage')}
              subtitle={t('pdfOrImage')}
              fileName={idFrontName}
              fileUri={idFrontUri}
              loading={idFrontLoading}
              onPick={handlePickIdFront}
              onRemove={() => { setIdFrontUri(null); setIdFrontName(null) }}
            />
          </>
        )}

        {!isValid && (
          <View style={styles.reminderNote}>
            <Ionicons name="information-circle-outline" size={15} color={colors.warning} />
            <Text style={styles.reminderText}>
              {licenseUris.length === 0
                ? t('reminderUploadLicense')
                : idDocType === 'national_id'
                ? t('reminderBothSidesId')
                : t('reminderPassport')}
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <View style={styles.backBtnWrap}>
            <OutlineButton label={t('back')} onPress={() => router.back()} />
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

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 4 },
  sectionHint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 12, lineHeight: 18 },
  subLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280', marginBottom: 8 },

  addDocBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.careBlue, borderStyle: 'dashed',
    borderRadius: 16, padding: 16, marginBottom: 8, backgroundColor: '#EFF6FF',
  },
  addDocText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.careBlue },

  idSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  optionalBadge: {
    backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  optionalText: { fontFamily: fonts.medium, fontSize: 11, color: '#6B7280' },

  idTypeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  idTypeChipWrap: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  idTypeChip: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  idTypeChipUnselected: { backgroundColor: colors.cloudGrey, borderWidth: 1.5, borderColor: colors.steelGrey },
  idTypeText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },

  idNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 12,
  },
  idNoteText: { fontFamily: fonts.regular, fontSize: 12, color: colors.information, flex: 1, lineHeight: 17 },

  uploadCard: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 16,
    backgroundColor: colors.mistWhite, marginBottom: 12, overflow: 'hidden',
  },
  uploadTouchable: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
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
