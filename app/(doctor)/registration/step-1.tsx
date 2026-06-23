import { useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GradientButton } from '@/components/ui/GradientButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { MIN_AGE_DOCTOR, meetsAgeRequirement } from '@/lib/ageValidation'
import { supabaseEmailAuth } from '@/lib/supabase'
import { type Gender, useDoctorStore } from '@/store/doctorStore'
import { useTranslation } from 'react-i18next'

// ─── Constants ────────────────────────────────────────────────────────────────

const GENDERS: Gender[] = ['Male', 'Female']

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i))

const WHEEL_ITEM_H = 46

interface DateValue { day: number; month: number; year: number }

// ─── WheelColumn ──────────────────────────────────────────────────────────────

function WheelColumn({
  items, selectedIndex, onChange, width,
}: {
  items: string[]; selectedIndex: number; onChange: (i: number) => void; width: number
}) {
  const ref = useRef<ScrollView>(null)

  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_H, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.max(0, Math.min(Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H), items.length - 1))
    onChange(idx)
  }, [items.length, onChange])

  return (
    <View style={[wStyles.col, { width }]}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={{ paddingTop: WHEEL_ITEM_H, paddingBottom: WHEEL_ITEM_H }}
        style={{ flex: 1 }}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[wStyles.itemText, i === selectedIndex && wStyles.itemTextSel]}>{item}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={[wStyles.fade, { top: 0, pointerEvents: 'none' }]} />
      <View style={[wStyles.fade, { bottom: 0, pointerEvents: 'none' }]} />
      <View style={[wStyles.highlight, { pointerEvents: 'none' }]} />
    </View>
  )
}

const wStyles = StyleSheet.create({
  col: { height: WHEEL_ITEM_H * 3, overflow: 'hidden', position: 'relative' },
  itemText: { fontFamily: fonts.regular, fontSize: 16, color: '#9CA3AF' },
  itemTextSel: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkBlack },
  highlight: {
    position: 'absolute', top: WHEEL_ITEM_H, left: 6, right: 6, height: WHEEL_ITEM_H,
    borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.tealGreen,
    borderRadius: 8, backgroundColor: '#F0FDFB', zIndex: -1,
  },
  fade: {
    position: 'absolute', left: 0, right: 0, height: WHEEL_ITEM_H, zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
})

// ─── DatePickerModal ──────────────────────────────────────────────────────────

function DatePickerModal({
  visible, value, onConfirm, onCancel,
}: {
  visible: boolean; value: DateValue; onConfirm: (v: DateValue) => void; onCancel: () => void
}) {
  const { t } = useTranslation()
  const [day, setDay] = useState(value.day)
  const [month, setMonth] = useState(value.month)
  const [year, setYear] = useState(value.year)

  useEffect(() => {
    setDay(value.day); setMonth(value.month); setYear(value.year)
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={dpStyles.overlay}>
        <View style={dpStyles.sheet}>
          <View style={dpStyles.header}>
            <Text style={dpStyles.title}>{t('dateOfBirth')}</Text>
            <Pressable onPress={onCancel} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.inkBlack} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingHorizontal: 4 }}>
            <Text style={[dpStyles.colLabel, { width: 64 }]}>{t('day')}</Text>
            <Text style={[dpStyles.colLabel, { flex: 1 }]}>{t('month')}</Text>
            <Text style={[dpStyles.colLabel, { width: 72 }]}>{t('year')}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: 24 }}>
            <WheelColumn items={DAYS} selectedIndex={day - 1} onChange={(i) => setDay(i + 1)} width={64} />
            <WheelColumn items={MONTHS} selectedIndex={month} onChange={(i) => setMonth(i)} width={130} />
            <WheelColumn items={YEARS} selectedIndex={year} onChange={(i) => setYear(i)} width={72} />
          </View>
          <Pressable onPress={() => onConfirm({ day, month, year })} style={{ borderRadius: 16, overflow: 'hidden' }}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dpStyles.confirmGrad}>
              <Text style={dpStyles.confirmText}>{t('done')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const dpStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 32, paddingTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  colLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: '#9CA3AF', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },
  confirmGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RegistrationStep1() {
  const { t } = useTranslation()
  const router = useRouter()
  const { user } = useUser()
  const { updateReg, regFullName, regPhone, regDateOfBirth, regGender, regProfilePhotoUri } = useDoctorStore()

  const [fullName, setFullName] = useState(regFullName)

  useEffect(() => {
    if (fullName) return
    if (user?.fullName) { setFullName(user.fullName); return }
    supabaseEmailAuth.auth.getUser().then(({ data: { user: supaUser } }) => {
      const name = supaUser?.user_metadata?.full_name as string | undefined
      if (name) setFullName(name)
    })
  }, [user?.fullName])

  const [phone, setPhone] = useState(regPhone)
  const [countryCode, setCountryCode] = useState('+251')
  const [showCodePicker, setShowCodePicker] = useState(false)
  const COUNTRY_CODES = [
    { code: '+251', label: '🇪🇹 Ethiopia' },
    { code: '+252', label: '🇸🇴 Somalia' },
    { code: '+253', label: '🇩🇯 Djibouti' },
    { code: '+254', label: '🇰🇪 Kenya' },
    { code: '+256', label: '🇺🇬 Uganda' },
    { code: '+249', label: '🇸🇩 Sudan' },
    { code: '+966', label: '🇸🇦 Saudi Arabia' },
    { code: '+971', label: '🇦🇪 UAE' },
    { code: '+1',   label: '🇺🇸 United States' },
    { code: '+44',  label: '🇬🇧 United Kingdom' },
  ]
  const [gender, setGender] = useState<Gender | null>(regGender)
  const [photoUri, setPhotoUri] = useState<string | null>(regProfilePhotoUri)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dobError, setDobError] = useState('')

  // Parse stored ISO date back to DateValue for the picker
  const [dob, setDob] = useState<DateValue | null>(() => {
    if (!regDateOfBirth) return null
    const d = new Date(regDateOfBirth)
    if (isNaN(d.getTime())) return null
    const yearIdx = YEARS.indexOf(String(d.getFullYear()))
    if (yearIdx === -1) return null
    return { day: d.getDate(), month: d.getMonth(), year: yearIdx }
  })

  const dobLabel = dob ? `${DAYS[dob.day - 1]} ${MONTHS[dob.month]} ${YEARS[dob.year]}` : ''
  // Default picker position — 30 years ago is a sensible start for a doctor
  const dobPickerDefault: DateValue = dob ?? { day: 1, month: 0, year: 30 }

  const isValid = fullName.trim().length > 1 && phone.trim().length > 5 && dob !== null && gender !== null

  const handlePickPhoto = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => setPhotoUri(ev.target?.result as string)
        reader.readAsDataURL(file)
      }
      input.click()
      return
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('permissionNeeded'), t('photoPermissionMsg'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) setPhotoUri(result.assets[0].uri)
  }

  const handleNext = () => {
    if (dob) {
      const birth = new Date(Number(YEARS[dob.year]), dob.month, dob.day)
      if (!meetsAgeRequirement(birth, 'doctor')) {
        setDobError(`You must be at least ${MIN_AGE_DOCTOR} years old to register as a doctor.`)
        return
      }
    }
    setDobError('')
    const dobIso = dob
      ? new Date(Number(YEARS[dob.year]), dob.month, dob.day).toISOString().split('T')[0]
      : ''
    updateReg({ regFullName: fullName, regPhone: `${countryCode}${phone}`, regDateOfBirth: dobIso, regGender: gender, regProfilePhotoUri: photoUri })
    router.push('/(doctor)/registration/step-2')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Top row */}
        <View style={styles.topRow}>
          <Pressable onPress={() => router.replace('/(auth)/role' as never)} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.stepLabel}>{t('stepOf')} 1 {t('of')} 4</Text>
        </View>

        <Text style={styles.title}>{t('createYourProfile')}</Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: '25%' }]} />
        </View>

        {/* Profile photo — hint is outside the circle so it never gets clipped */}
        <View style={styles.photoSection}>
          <Pressable onPress={handlePickPhoto} style={styles.photoCircle}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoImage} />
            ) : (
              <View style={styles.cameraIconBg}>
                <Ionicons name="camera" size={30} color={colors.careBlue} />
              </View>
            )}
          </Pressable>
          <Text style={styles.photoHint}>{photoUri ? t('tapToChangePhoto') : t('tapToAddPhoto')}</Text>
        </View>

        {/* Full Name */}
        <Text style={styles.label}>{t('fullName')}</Text>
        <TextInput
          style={styles.input}
          placeholder="Dr. Jane Smith"
          placeholderTextColor="#9CA3AF"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        {/* Phone Number */}
        <Text style={styles.label}>{t('phoneNumber')}</Text>
        <View style={styles.phoneRow}>
          <Pressable style={styles.countryCode} onPress={() => setShowCodePicker(true)}>
            <Text style={styles.countryCodeText}>{countryCode}</Text>
            <Ionicons name="chevron-down" size={12} color={colors.inkBlack} style={{ marginLeft: 2 }} />
          </Pressable>
          <TextInput
            style={[styles.input, styles.phoneInput]}
            placeholder="912 345 678"
            placeholderTextColor="#9CA3AF"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        {/* Country code picker modal */}
        <Modal visible={showCodePicker} transparent animationType="slide" onRequestClose={() => setShowCodePicker(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowCodePicker(false)} />
          <View style={{ backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, marginBottom: 12 }}>Select Country Code</Text>
            {COUNTRY_CODES.map(c => (
              <Pressable key={c.code} onPress={() => { setCountryCode(c.code); setShowCodePicker(false) }}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack }}>{c.label}</Text>
                <Text style={{ fontFamily: fonts.semiBold, fontSize: 14, color: colors.tealGreen }}>{c.code}</Text>
              </Pressable>
            ))}
          </View>
        </Modal>

        {/* Date of Birth — wheel picker */}
        <Text style={styles.label}>{t('dateOfBirth')}</Text>
        <Pressable onPress={() => setShowDatePicker(true)} style={styles.pickerField}>
          <Text style={[styles.pickerFieldText, !dobLabel && { color: '#9CA3AF' }]}>
            {dobLabel || t('selectDateOfBirth')}
          </Text>
          <Ionicons name="calendar-outline" size={18} color="#9CA3AF" />
        </Pressable>
        {!!dobError && <Text style={styles.errorText}>{dobError}</Text>}

        {/* Gender */}
        <Text style={styles.label}>{t('gender')}</Text>
        <View style={styles.genderRow}>
          {GENDERS.map((g) => {
            const selected = gender === g
            return (
              <Pressable key={g} onPress={() => setGender(g)} style={styles.genderChipWrap}>
                {selected ? (
                  <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.genderChip}>
                    <Text style={[styles.genderText, styles.genderTextSelected]}>{g}</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.genderChip, styles.genderChipUnselected]}>
                    <Text style={styles.genderText}>{g}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <GradientButton label={t('next')} onPress={handleNext} disabled={!isValid} />
      </View>

      <DatePickerModal
        visible={showDatePicker}
        value={dobPickerDefault}
        onConfirm={(v) => { setDob(v); setDobError(''); setShowDatePicker(false) }}
        onCancel={() => setShowDatePicker(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingHorizontal: 24, paddingTop: 12 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  stepLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 16 },

  progressTrack: { height: 6, backgroundColor: colors.cloudGrey, borderRadius: 3, marginBottom: 28, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  photoSection: { alignItems: 'center', marginBottom: 28 },
  photoCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.steelGrey,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  photoImage: { width: 110, height: 110, borderRadius: 55 },
  cameraIconBg: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  photoHint: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen, marginTop: 10 },

  label: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 8, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack,
    backgroundColor: colors.mistWhite, marginBottom: 16,
  },

  phoneRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  countryCode: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 14, justifyContent: 'center', backgroundColor: colors.cloudGrey,
  },
  countryCodeText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  phoneInput: { flex: 1, marginBottom: 0 },

  pickerField: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.mistWhite, marginBottom: 8,
  },
  pickerFieldText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  errorText: { fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginBottom: 12, marginLeft: 2 },

  genderRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  genderChipWrap: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  genderChip: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  genderChipUnselected: { backgroundColor: colors.cloudGrey, borderWidth: 1.5, borderColor: colors.steelGrey },
  genderText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#6B7280' },
  genderTextSelected: { color: colors.mistWhite },

  footer: { paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
})
