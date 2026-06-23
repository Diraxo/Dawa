import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { File as ExpoFile } from 'expo-file-system'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

function getExt(uri: string, fileName: string | null): string {
  if (uri.startsWith('data:')) {
    const mime = uri.match(/^data:([^;]+)/)?.[1] ?? ''
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'application/pdf': 'pdf',
    }
    return mimeMap[mime] ?? 'bin'
  }
  return (fileName ?? uri).split('.').pop()?.toLowerCase() ?? 'pdf'
}

async function getFileBuffer(uri: string): Promise<ArrayBuffer> {
  // data: URIs (from web FileReader) and web in general — use fetch
  if (Platform.OS === 'web' || uri.startsWith('data:')) {
    const resp = await fetch(uri)
    return resp.arrayBuffer()
  }
  // Native — use expo-file-system
  const bytes = await new ExpoFile(uri).bytes()
  return bytes.buffer as ArrayBuffer
}

async function uploadDocument(
  client: ReturnType<typeof getAuthClient>,
  clerkId: string,
  uri: string,
  fileName: string | null,
  label: string
): Promise<string> {
  const ext = getExt(uri, fileName)
  const path = `${clerkId}/${label}-${Date.now()}.${ext}`
  const buffer = await getFileBuffer(uri)
  const { error } = await client.storage
    .from('doctor-documents')
    .upload(path, buffer, {
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      upsert: true,
    })
  if (error) throw new Error(`Failed to upload ${label}: ${error.message}`)
  return path
}

interface PriceCardProps {
  icon: string
  title: string
  description: string
  value: string
  onChange: (v: string) => void
}

function PriceCard({ icon, title, description, value, onChange }: PriceCardProps) {
  return (
    <View style={styles.priceCard}>
      <View style={styles.priceCardLeft}>
        <View style={styles.priceIconWrap}>
          <Text style={styles.priceIcon}>{icon}</Text>
        </View>
        <View style={styles.priceTextWrap}>
          <Text style={styles.priceTitle}>{title}</Text>
          <Text style={styles.priceDescription}>{description}</Text>
        </View>
      </View>
      <View style={styles.priceInputWrap}>
        <Text style={styles.currencySymbol}>ETB</Text>
        <TextInput
          style={styles.priceInput}
          placeholder="0"
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ''))}
          keyboardType="numeric"
          maxLength={6}
        />
      </View>
    </View>
  )
}

export default function RegistrationStep4() {
  const router = useRouter()
  const store = useDoctorStore()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { t } = useTranslation()

  const { setDoctorStatus } = useDoctorStore()
  const [chatPrice, setChatPrice] = useState(store.regChatPrice)
  const [phonePrice, setPhonePrice] = useState(store.regPhonePrice)
  const [videoPrice, setVideoPrice] = useState(store.regVideoPrice)
  const [submitting, setSubmitting] = useState(false)

  const isValid = chatPrice.length > 0 && phonePrice.length > 0 && videoPrice.length > 0

  const handleSubmit = async () => {
    if (!isValid || submitting || !user) return
    setSubmitting(true)
    store.updateReg({ regChatPrice: chatPrice, regPhonePrice: phonePrice, regVideoPrice: videoPrice })

    // Track uploaded paths so we can clean them up if the DB write fails
    const uploadedDocs: { bucket: string; path: string }[] = []

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated. Please sign in again.')
      const client = getAuthClient(token)

      const { data: userData, error: userErr } = await client
        .from('users')
        .upsert(
          {
            clerk_id: user.id,
            email: user.primaryEmailAddress?.emailAddress ?? '',
            full_name: store.regFullName || (user.fullName ?? ''),
            phone: store.regPhone || null,
            role: 'doctor',
          },
          { onConflict: 'clerk_id' }
        )
        .select('id')
        .single()
      if (userErr || !userData) throw new Error('Could not save your account. Please try again.')

      // Upload profile photo from step 1 if available
      if (store.regProfilePhotoUri) {
        try {
          const photoBuffer = await getFileBuffer(store.regProfilePhotoUri)
          let photoExt = 'jpg'
          if (store.regProfilePhotoUri.startsWith('data:')) {
            photoExt = store.regProfilePhotoUri.match(/^data:image\/([^;]+)/)?.[1] ?? 'jpg'
          } else {
            photoExt = store.regProfilePhotoUri.split('.').pop()?.toLowerCase() ?? 'jpg'
          }
          // Path must be clerk_id/filename so the RLS foldername policy passes
          const photoPath = `${user.id}/profile.${photoExt}`
          const { error: photoErr } = await client.storage
            .from('avatars')
            .upload(photoPath, photoBuffer, {
              contentType: `image/${photoExt === 'jpg' ? 'jpeg' : photoExt}`,
              upsert: true,
            })
          if (!photoErr) {
            uploadedDocs.push({ bucket: 'avatars', path: photoPath })
            const { data: photoUrlData } = client.storage.from('avatars').getPublicUrl(photoPath)
            await client.from('users')
              .update({ profile_photo_url: photoUrlData.publicUrl })
              .eq('clerk_id', user.id)
          }
        } catch {
          // Photo upload failed — proceed without blocking registration
        }
      }

      // Upload multiple license docs → store as JSON array
      const licensePaths: string[] = []
      for (let i = 0; i < store.regLicenseDocUris.length; i++) {
        const path = await uploadDocument(client, user.id, store.regLicenseDocUris[i], store.regLicenseDocNames[i] ?? null, `license-${i}`)
        licensePaths.push(path)
        uploadedDocs.push({ bucket: 'doctor-documents', path })
      }
      const licenseDocUrl = licensePaths.length > 0 ? JSON.stringify(licensePaths) : null

      // Upload ID document (national ID or passport) — optional
      let idDocUrl: string | null = null
      if (store.regIdDocType === 'national_id') {
        const frontPath = store.regNationalIdFrontUri
          ? await uploadDocument(client, user.id, store.regNationalIdFrontUri, store.regNationalIdFrontName, 'national-id-front')
          : null
        if (frontPath) uploadedDocs.push({ bucket: 'doctor-documents', path: frontPath })
        const backPath = store.regNationalIdBackUri
          ? await uploadDocument(client, user.id, store.regNationalIdBackUri, store.regNationalIdBackName, 'national-id-back')
          : null
        if (backPath) uploadedDocs.push({ bucket: 'doctor-documents', path: backPath })
        if (frontPath || backPath) {
          idDocUrl = JSON.stringify({ type: 'national_id', front: frontPath, back: backPath })
        }
      } else if (store.regIdDocType === 'passport' && store.regNationalIdFrontUri) {
        const passportPath = await uploadDocument(client, user.id, store.regNationalIdFrontUri, store.regNationalIdFrontName, 'passport')
        uploadedDocs.push({ bucket: 'doctor-documents', path: passportPath })
        idDocUrl = JSON.stringify({ type: 'passport', file: passportPath })
      }

      const { error: profileErr } = await client.from('doctor_profiles').upsert(
        {
          user_id: userData.id,
          license_number: store.regLicenseNumber,
          specialty: store.regSpecialty,
          years_experience: store.regYearsOfExperience,
          hospital_name: store.regHospitalName,
          bio: store.regBio,
          license_doc_url: licenseDocUrl,
          id_doc_url: idDocUrl,
          chat_price: parseInt(chatPrice, 10) || 0,
          phone_price: parseInt(phonePrice, 10) || 0,
          video_price: parseInt(videoPrice, 10) || 0,
          status: 'pending',
          date_of_birth: store.regDateOfBirth || null,
          gender: store.regGender || null,
        },
        { onConflict: 'user_id' }
      )
      if (profileErr) {
        // Roll back uploads so storage stays clean
        await Promise.allSettled(
          uploadedDocs.map(({ bucket, path }) => client.storage.from(bucket).remove([path]))
        )
        throw new Error(`Could not submit your application: ${profileErr.message}`)
      }

      setDoctorStatus('pending')
      router.replace('/(doctor)/registration/under-review')
    } catch (err) {
      Alert.alert(t('submissionFailed'), err instanceof Error ? err.message : t('somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Top row */}
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
            </Pressable>
            <Text style={styles.stepLabel}>Step 4 of 4</Text>
          </View>

          <Text style={styles.title}>{t('setConsultationPrices')}</Text>

          {/* Progress bar - 100% */}
          <View style={styles.progressTrack}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.progressFull} />
          </View>

          {/* Revenue split note */}
          <View style={styles.revenueNote}>
            <Ionicons name="wallet-outline" size={18} color={colors.tealGreen} />
            <Text style={styles.revenueText}>{t('revenueNoteText')}</Text>
          </View>

          {/* Price Cards */}
          <PriceCard icon="💬" title={t('chatConsultation')} description={t('chatConsultationDesc2')} value={chatPrice} onChange={setChatPrice} />
          <PriceCard icon="📞" title={t('phoneCall')} description={t('phoneCallDesc')} value={phonePrice} onChange={setPhonePrice} />
          <PriceCard icon="🎥" title={t('videoCall')} description={t('videoCallDesc')} value={videoPrice} onChange={setVideoPrice} />

          <Text style={styles.priceNote}>{t('pricesChangeNote')}</Text>

          {/* Earnings Preview */}
          {isValid && (
            <View style={styles.earningsCard}>
              <Text style={styles.earningsTitle}>{t('earningsPreview')}</Text>
              <Text style={styles.earningsSub}>{t('afterPlatformFee')}</Text>
              {[
                { label: t('chatConsultation'), value: chatPrice, icon: '💬' },
                { label: t('phoneCall'), value: phonePrice, icon: '📞' },
                { label: t('videoCall'), value: videoPrice, icon: '🎥' },
              ].map(({ label, value, icon }) => {
                const net = value ? Math.floor(Number(value) * 0.8) : 0
                return (
                  <View key={label} style={styles.earningsRow}>
                    <Text style={styles.earningsIcon}>{icon}</Text>
                    <Text style={styles.earningsLabel}>{label}</Text>
                    <Text style={styles.earningsAmount}>ETB {net.toLocaleString()}</Text>
                    <Text style={styles.earningsNote}>{t('perSession')}</Text>
                  </View>
                )
              })}
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <View style={styles.backBtnWrap}>
              <OutlineButton label={t('back')} onPress={() => router.back()} />
            </View>
            <View style={styles.submitBtnWrap}>
              <GradientButton
                label={submitting ? `${t('submitForReview')}...` : t('submitApplication')}
                onPress={handleSubmit}
                disabled={!isValid || submitting}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  progressFull: { height: '100%', width: '100%', borderRadius: 3 },

  revenueNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#F0FDFB', borderRadius: 12, padding: 14, marginBottom: 24,
    borderWidth: 1, borderColor: '#CCFBF1',
  },
  revenueText: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkBlack, flex: 1, lineHeight: 18 },
  revenueBold: { fontFamily: fonts.bold, color: colors.tealGreen },

  priceCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.mistWhite, borderRadius: 16,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 16, marginBottom: 14, gap: 12,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  priceCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceIconWrap: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center',
  },
  priceIcon: { fontSize: 22 },
  priceTextWrap: { flex: 1 },
  priceTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  priceDescription: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },

  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  currencySymbol: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },
  priceInput: {
    width: 80, borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack,
    textAlign: 'center',
  },

  priceNote: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  earningsCard: {
    backgroundColor: '#F0FDF4', borderRadius: 16, padding: 16, marginTop: 16,
    borderWidth: 1, borderColor: '#BBFBCD',
  },
  earningsTitle: { fontFamily: fonts.bold, fontSize: 15, color: '#15803D', marginBottom: 2 },
  earningsSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 12 },
  earningsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#DCFCE7' },
  earningsIcon: { fontSize: 16 },
  earningsLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkBlack, flex: 1 },
  earningsAmount: { fontFamily: fonts.bold, fontSize: 14, color: '#15803D' },
  earningsNote: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280' },

  footer: { paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  footerRow: { flexDirection: 'row', gap: 12 },
  backBtnWrap: { flex: 1 },
  submitBtnWrap: { flex: 2 },
})
