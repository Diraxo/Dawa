import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ChangeEmailModal } from '@/components/ui/ChangeEmailModal'
import { CountryPickerModal } from '@/components/ui/CountryPickerModal'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { useNavGuard } from '@/hooks/useNavGuard'
import { prepareImageForUpload, UnsupportedImageFormatError, waitForModalDismiss } from '@/lib/imagePicker'
import { MIN_AGE_PATIENT, meetsAgeRequirement } from '@/lib/ageValidation'
import { sanitize } from '@/lib/sanitize'
import { pushOwnNameToStream, pushOwnPhotoToStream } from '@/lib/stream'
import { deleteProfilePhotos, getAuthClient, uploadProfilePhoto } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useTranslation } from 'react-i18next'

// ─── Constants ────────────────────────────────────────────────────────────────

const GENDER_KEYS = ['Male', 'Female', 'Prefer not to say'] as const

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - i))

const WHEEL_ITEM_H = 46

// ─── WheelColumn ──────────────────────────────────────────────────────────────

function WheelColumn({
  items,
  selectedIndex,
  onChange,
  width,
}: {
  items: string[]
  selectedIndex: number
  onChange: (index: number) => void
  width: number
}) {
  const ref = useRef<ScrollView>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_H, animated: false })
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = e.nativeEvent.contentOffset.y
      const idx = Math.max(0, Math.min(Math.round(raw / WHEEL_ITEM_H), items.length - 1))
      onChange(idx)
    },
    [items.length, onChange]
  )

  return (
    <View style={[wheelStyles.col, { width }]}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={wheelStyles.scrollContent}
        style={wheelStyles.scroll}
      >
        {items.map((item, i) => (
          <View key={i} style={wheelStyles.item}>
            <Text style={[wheelStyles.itemText, i === selectedIndex && wheelStyles.itemTextSel]}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={[wheelStyles.fade, wheelStyles.fadeTop, { pointerEvents: 'none' }]} />
      <View style={[wheelStyles.fade, wheelStyles.fadeBottom, { pointerEvents: 'none' }]} />
      <View style={[wheelStyles.highlight, { pointerEvents: 'none' }]} />
    </View>
  )
}

const wheelStyles = StyleSheet.create({
  col: {
    height: WHEEL_ITEM_H * 3,
    overflow: 'hidden',
    position: 'relative',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: WHEEL_ITEM_H,
    paddingBottom: WHEEL_ITEM_H,
  },
  item: {
    height: WHEEL_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: '#9CA3AF',
  },
  itemTextSel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.inkBlack,
  },
  highlight: {
    position: 'absolute',
    top: WHEEL_ITEM_H,
    left: 6,
    right: 6,
    height: WHEEL_ITEM_H,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.tealGreen,
    borderRadius: 8,
    backgroundColor: '#F0FDFB',
    zIndex: -1,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WHEEL_ITEM_H,
    zIndex: 2,
    pointerEvents: 'none' as any,
  },
  fadeTop: { top: 0, backgroundColor: 'rgba(255,255,255,0.72)' },
  fadeBottom: { bottom: 0, backgroundColor: 'rgba(255,255,255,0.72)' },
})

// ─── DatePickerModal ──────────────────────────────────────────────────────────

interface DateValue { day: number; month: number; year: number }

function DatePickerModal({
  visible,
  value,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  value: DateValue
  onConfirm: (v: DateValue) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [day, setDay] = useState(value.day)
  const [month, setMonth] = useState(value.month)
  const [year, setYear] = useState(value.year)

  useEffect(() => {
    setDay(value.day)
    setMonth(value.month)
    setYear(value.year)
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

          <View style={dpStyles.labels}>
            <Text style={[dpStyles.colLabel, { width: 64 }]}>{t('day')}</Text>
            <Text style={[dpStyles.colLabel, { flex: 1 }]}>{t('month')}</Text>
            <Text style={[dpStyles.colLabel, { width: 72 }]}>{t('year')}</Text>
          </View>

          <View style={dpStyles.wheels}>
            <WheelColumn items={DAYS} selectedIndex={day - 1} onChange={(i) => setDay(i + 1)} width={64} />
            <WheelColumn items={MONTHS} selectedIndex={month} onChange={(i) => setMonth(i)} width={130} />
            <WheelColumn items={YEARS} selectedIndex={year} onChange={(i) => setYear(i)} width={72} />
          </View>

          <Pressable
            style={({ pressed }) => [dpStyles.confirmWrap, pressed && { opacity: 0.88 }]}
            onPress={() => onConfirm({ day, month, year })}
          >
            <LinearGradient
              colors={gradients.interactive}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={dpStyles.confirmGrad}
            >
              <Text style={dpStyles.confirmText}>{t('done')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.inkBlack,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  colLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wheels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 24,
  },
  confirmWrap: { borderRadius: 16, overflow: 'hidden' },
  confirmGrad: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.mistWhite,
  },
})

// ─── GenderPickerModal ────────────────────────────────────────────────────────

const GENDER_LABEL_MAP: Record<string, 'male' | 'female' | 'preferNotToSay'> = {
  'Male': 'male',
  'Female': 'female',
  'Prefer not to say': 'preferNotToSay',
}

// patient_profiles.gender has a CHECK constraint accepting only these lowercase
// values ('other' is the DB's neutral option — there is no literal "prefer not
// to say" value) — the UI's capitalized labels must be translated before writing,
// and back on read, or every save silently violates the constraint and is dropped.
const GENDER_UI_TO_DB: Record<string, string> = {
  'Male': 'male',
  'Female': 'female',
  'Prefer not to say': 'other',
}
const GENDER_DB_TO_UI: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Prefer not to say',
}

function GenderPickerModal({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean
  selected: string
  onSelect: (g: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={gpStyles.overlay} onPress={onClose}>
        <View style={gpStyles.card}>
          <Text style={gpStyles.title}>{t('selectGender')}</Text>
          {GENDER_KEYS.map((g) => (
            <TouchableOpacity
              key={g}
              style={gpStyles.option}
              onPress={() => { onSelect(g); onClose() }}
            >
              <Text style={[gpStyles.optText, selected === g && gpStyles.optTextSel]}>
                {t(GENDER_LABEL_MAP[g])}
              </Text>
              {selected === g && (
                <Ionicons name="checkmark" size={18} color={colors.tealGreen} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  )
}

const gpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    ...shadow('#000', 0, 8, 20, 0.15, 8),
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.inkBlack,
    marginBottom: 12,
    marginTop: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.cloudGrey,
  },
  optText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.inkBlack,
  },
  optTextSel: { color: colors.tealGreen, fontFamily: fonts.semiBold },
})

// ─── PhotoPickerModal ─────────────────────────────────────────────────────────

function PhotoPickerModal({
  visible,
  onCamera,
  onGallery,
  onClose,
}: {
  visible: boolean
  onCamera: () => void
  onGallery: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={ppStyles.overlay} onPress={onClose}>
        <View style={ppStyles.sheet}>
          <Text style={ppStyles.title}>{t('changeProfilePhoto')}</Text>
          <Pressable style={ppStyles.option} onPress={onCamera}>
            <View style={ppStyles.iconWrap}>
              <Ionicons name="camera-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={ppStyles.optionText}>{t('takePhoto')}</Text>
          </Pressable>
          <View style={ppStyles.divider} />
          <Pressable style={ppStyles.option} onPress={onGallery}>
            <View style={ppStyles.iconWrap}>
              <Ionicons name="images-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={ppStyles.optionText}>{t('chooseFromGallery')}</Text>
          </Pressable>
          <View style={ppStyles.divider} />
          <Pressable style={[ppStyles.option, ppStyles.cancelOption]} onPress={onClose}>
            <Text style={ppStyles.cancelText}>{t('cancel')}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const ppStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 16,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.inkBlack,
  },
  divider: {
    height: 1,
    backgroundColor: colors.cloudGrey,
    marginLeft: 52,
  },
  cancelOption: {
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.error,
  },
})

// ─── FormField ────────────────────────────────────────────────────────────────

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  keyboardType,
  suffix,
  onPress,
  multiline = false,
}: {
  label: string
  value: string
  onChangeText?: (t: string) => void
  placeholder?: string
  editable?: boolean
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']
  suffix?: React.ReactNode
  onPress?: () => void
  multiline?: boolean
}) {
  const content = (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={[fieldStyles.inputRow, multiline && fieldStyles.inputRowMultiline, !editable && fieldStyles.inputRowDisabled]}>
        <TextInput
          style={[fieldStyles.input, multiline && fieldStyles.inputMultiline, !editable && fieldStyles.inputDisabled, { pointerEvents: onPress ? 'none' : 'auto' }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          editable={editable && !onPress}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={multiline ? 2 : undefined}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {suffix}
      </View>
    </View>
  )

  if (onPress) {
    return (
      <Pressable style={({ pressed }) => pressed && { opacity: 0.8 }} onPress={onPress}>
        {content}
      </Pressable>
    )
  }
  return content
}

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#374151',
    marginBottom: 7,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cloudGrey,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.steelGrey,
    paddingHorizontal: 14,
    height: 50,
  },
  inputRowDisabled: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  inputRowMultiline: {
    height: undefined,
    minHeight: 54,
    maxHeight: 90,
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.inkBlack,
    padding: 0,
  },
  inputMultiline: {
    minHeight: 30,
  },
  inputDisabled: { color: '#9CA3AF' },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.error,
    marginTop: 5,
    marginBottom: 12,
    marginLeft: 2,
  },
  fieldSpacing: { marginBottom: 18 },
})

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditPersonalInfoScreen() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const { t } = useTranslation()
  const { selectedCountry } = useAppStore()
  const guardNav = useNavGuard()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('')
  const [country, setCountry] = useState('')
  const [address, setAddress] = useState('')
  const [localImageUri, setLocalImageUri] = useState<string | null>(null)
  const [localImageMimeType, setLocalImageMimeType] = useState<string | null>(null)
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null)
  const [dbPhotoUrl, setDbPhotoUrl] = useState<string | null>(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)

  // Snapshot of what the DB actually had at load time (or the same defaults
  // the fields started at, if the load silently failed) — handleSave only
  // writes phone/country/address if they differ from this, so a failed
  // background fetch can never overwrite the patient's real saved values
  // with blanks just because they saved an unrelated field (e.g. gender).
  // Mirrors the doctor-side pattern in app/(doctor)/edit-profile.tsx.
  const initialPhoneRef = useRef('')
  const initialCountryRef = useRef(selectedCountry ?? '')
  const initialAddressRef = useRef('')
  // Same guard, extended to gender/DOB (previously unprotected — see C-3 in
  // the July 30 2026 profile audit): snapshot what patient_profiles actually
  // had at load time so handleSave only writes these fields when they
  // differ from that snapshot, never when the async load just hasn't
  // resolved yet.
  const initialGenderRef = useRef('')
  const initialDobIsoRef = useRef<string | null>(null)

  const defaultDob: DateValue = useMemo(() => ({ day: 1, month: 0, year: 10 }), [])
  const [dob, setDob] = useState<DateValue>(defaultDob)
  const [dobError, setDobError] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showGenderPicker, setShowGenderPicker] = useState(false)
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [saving, setSaving] = useState(false)

  const dobLabel = useMemo(() => {
    if (dob === defaultDob) return ''
    return `${DAYS[dob.day - 1]} ${MONTHS[dob.month]} ${YEARS[dob.year]}`
  }, [dob, defaultDob])

  // Load existing profile from Supabase
  useEffect(() => {
    if (!user?.id) return
    async function load() {
      const token = await getToken()
      if (!token) { setCountry(selectedCountry ?? ''); return }
      const client = getAuthClient(token)

      const { data: ud, error: udError } = await client
        .from('users')
        .select('id, phone, country, address, profile_photo_url')
        .eq('clerk_id', user!.id)
        .single()
      if (udError) console.error('Failed to load user profile:', udError)

      if (ud) {
        setSupabaseUserId((ud as any).id)
        const loadedPhone = (ud as any).phone ?? ''
        const loadedCountry = (ud as any).country ?? selectedCountry ?? ''
        const loadedAddress = (ud as any).address ?? ''
        setPhone(loadedPhone)
        setCountry(loadedCountry)
        setAddress(loadedAddress)
        setDbPhotoUrl((ud as any).profile_photo_url ?? null)
        initialPhoneRef.current = loadedPhone
        initialCountryRef.current = loadedCountry
        initialAddressRef.current = loadedAddress

        // maybeSingle, not single: a new patient has no patient_profiles row
        // until their first gender/DOB save (see upsert below) — that's an
        // expected 0-row result, not an error.
        const { data: pp, error: ppError } = await client
          .from('patient_profiles')
          .select('date_of_birth, gender')
          .eq('user_id', ud.id)
          .maybeSingle()
        if (ppError) console.error('Failed to load patient profile:', ppError)

        if (pp) {
          const loadedGender = pp.gender ? (GENDER_DB_TO_UI[pp.gender] ?? '') : ''
          setGender(loadedGender)
          initialGenderRef.current = loadedGender
          initialDobIsoRef.current = pp.date_of_birth ?? null
          if (pp.date_of_birth) {
            const d = new Date(pp.date_of_birth)
            setDob({
              day: d.getDate(),
              month: d.getMonth(),
              year: YEARS.indexOf(String(d.getFullYear())),
            })
          }
        }
      } else {
        setCountry(selectedCountry ?? '')
      }
    }
    load()
  }, [user?.id])

  // ── Image picker ─────────────────────────────────────────────────────────────

  const handlePickPhoto = async (source: 'camera' | 'gallery') => {
    setShowPhotoPicker(false)
    await waitForModalDismiss()

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert(t('permissionRequired'), t('cameraPermissionMsg'))
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      })
      if (!result.canceled && result.assets[0]) {
        setLocalImageUri(result.assets[0].uri)
        setLocalImageMimeType(result.assets[0].mimeType ?? null)
        setPhotoRemoved(false)
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert(t('permissionRequired'), t('galleryPermissionMsg'))
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      })
      if (!result.canceled && result.assets[0]) {
        setLocalImageUri(result.assets[0].uri)
        setLocalImageMimeType(result.assets[0].mimeType ?? null)
        setPhotoRemoved(false)
      }
    }
  }

  const handleDeletePhoto = () => {
    Alert.alert(t('deletePhoto'), t('deletePhotoConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          setLocalImageUri(null)
          setLocalImageMimeType(null)
          setPhotoRemoved(true)
        },
      },
    ])
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user?.id) return

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert(t('profileSaveError'), 'Please enter your first and last name.')
      return
    }
    const phoneDigits = phone.replace(/[^0-9]/g, '')
    if (phone.trim() && (phoneDigits.length < 6 || /[^0-9+\-() ]/.test(phone.trim()))) {
      Alert.alert(t('profileSaveError'), 'Please enter a valid phone number.')
      return
    }

    // Validate age
    if (dobLabel) {
      const birthDate = new Date(Number(YEARS[dob.year]), dob.month, dob.day)
      if (!meetsAgeRequirement(birthDate, 'patient')) {
        setDobError(t('ageTooYoung', { minAge: MIN_AGE_PATIENT }))
        return
      }
    }
    setDobError('')

    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('not authenticated')
      const client = getAuthClient(token)

      // Two-phase write: Clerk first, mirrored onto users.full_name below.
      // Snapshot the current Clerk name so a failed Supabase write can be
      // rolled back to it — otherwise Clerk and Supabase could permanently
      // disagree about the patient's name (mirrors the doctor edit-profile
      // screen's same guard).
      const previousFirstName = user.firstName ?? ''
      const previousLastName = user.lastName ?? ''
      const nameChanged = firstName !== previousFirstName || lastName !== previousLastName
      // Strip HTML/script-breakout characters before anything is persisted —
      // this utility previously existed but was never wired up anywhere.
      const cleanFirstName = sanitize.text(firstName)
      const cleanLastName = sanitize.text(lastName)
      const cleanAddress = sanitize.text(address)
      if (nameChanged) {
        try {
          await user.update({ firstName: cleanFirstName, lastName: cleanLastName })
        } catch (e) {
          console.error('Failed to update name (Clerk):', e)
          throw new Error('Could not update your name. Please try again.')
        }
      }

      // Upload profile photo if a new one was picked, or clear it if deleted
      let profilePhotoUrl: string | null | undefined = undefined
      let photoUploadFailed = false
      let photoUploadErrorMessage: string | null = null
      if (localImageUri) {
        try {
          const prepared = await prepareImageForUpload(localImageUri, localImageMimeType)
          profilePhotoUrl = await uploadProfilePhoto(token, prepared.buffer, prepared.mimeType)
        } catch (e) {
          console.error('Failed to upload profile photo:', e)
          photoUploadFailed = true
          if (e instanceof UnsupportedImageFormatError) photoUploadErrorMessage = e.message
        }
      } else if (photoRemoved) {
        // Remove every file in this user's folder, not just avatar.jpg —
        // older upload flows used different filenames/extensions, and
        // leaving those behind orphans them in storage forever.
        try {
          await deleteProfilePhotos(token)
        } catch {}
        profilePhotoUrl = null
      }

      // Update users table, get back the Supabase UUID
      const { data: updated, error: userError } = await client
        .from('users')
        .update({
          full_name: `${cleanFirstName} ${cleanLastName}`.trim(),
          ...(phone !== initialPhoneRef.current ? { phone } : {}),
          ...(country !== initialCountryRef.current ? { country } : {}),
          ...(address !== initialAddressRef.current ? { address: cleanAddress.trim() || null } : {}),
          ...(profilePhotoUrl !== undefined ? { profile_photo_url: profilePhotoUrl } : {}),
        })
        .eq('clerk_id', user.id)
        .select('id')
        .single()
      if (userError) {
        console.error('Failed to update users row:', userError)
        if (nameChanged) {
          await user.update({ firstName: previousFirstName, lastName: previousLastName }).catch((e) => {
            console.error('Failed to roll back Clerk name after users-table write failure:', e)
          })
        }
        throw new Error(
          phone !== initialPhoneRef.current
            ? 'Could not update your phone number. Please try again.'
            : 'Could not save your changes. Please try again.'
        )
      }

      const uid = supabaseUserId ?? updated?.id

      // Stream only learns a user's name at connectUser() time, so without
      // this a doctor's already-open chat thread keeps showing the old
      // patient name until the app fully reconnects.
      if (nameChanged) pushOwnNameToStream(`${cleanFirstName} ${cleanLastName}`.trim())
      if (profilePhotoUrl !== undefined) pushOwnPhotoToStream(profilePhotoUrl)

      // Build ISO date string
      const dobDate = dobLabel
        ? new Date(Number(YEARS[dob.year]), dob.month, dob.day).toISOString().split('T')[0]
        : null

      // Upsert patient_profiles using Supabase UUID — only include gender/
      // date_of_birth when they actually differ from what was loaded, so a
      // save that races ahead of the patient_profiles fetch (still holding
      // pre-load defaults) can never null out previously-saved values.
      if (uid) {
        const genderChanged = gender !== initialGenderRef.current
        const dobChanged = dobDate !== initialDobIsoRef.current
        if (genderChanged || dobChanged) {
          const patientProfileUpdate: Record<string, unknown> = { user_id: uid }
          if (genderChanged) patientProfileUpdate.gender = gender ? GENDER_UI_TO_DB[gender] ?? null : null
          if (dobChanged) patientProfileUpdate.date_of_birth = dobDate
          const { error: profileError } = await client.from('patient_profiles').upsert(
            patientProfileUpdate,
            { onConflict: 'user_id' }
          )
          if (profileError) {
            console.error('Failed to update patient_profiles (gender/DOB):', profileError)
            throw new Error('Could not save your gender/date of birth. Please try again.')
          }
        }
      }

      // In-app only (spec issue 9) — no push, so a failure here must never
      // block the save the patient is actually waiting on.
      if (uid) {
        client.from('notifications').insert({
          user_id: uid,
          title: 'Profile Updated',
          body: 'Your profile information has been updated successfully.',
          type: 'profile_updated',
          data_json: { screen: 'profile' },
        }).then(() => {}, () => {})
      }

      if (photoUploadFailed) {
        Alert.alert(
          'Saved with a Problem',
          photoUploadErrorMessage ?? 'Your profile was updated, but the photo failed to upload. Please try again.'
        )
      } else {
        Alert.alert(t('profileSaved'), t('profileSavedMsg'))
      }
      router.back()
    } catch (e) {
      Alert.alert(t('profileSaveError'), e instanceof Error ? e.message : t('profileSaveErrorMsg'))
    } finally {
      setSaving(false)
    }
  }

  const displayImageUri = photoRemoved ? null : localImageUri ?? dbPhotoUrl ?? user?.imageUrl
  // OAuth-provider avatar URLs (Clerk's imageUrl, when there's no uploaded
  // photo) can expire or 404 without any DB-side signal — fall back to the
  // initials placeholder instead of a permanently broken image.
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  useEffect(() => { setAvatarLoadFailed(false) }, [displayImageUri])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={guardNav(() => router.back())}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('editProfile')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Pressable
            style={styles.avatarWrap}
            onPress={() => setShowPhotoPicker(true)}
          >
            {displayImageUri && !avatarLoadFailed ? (
              <Image
                source={{ uri: displayImageUri }}
                style={styles.avatar}
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>
                  {(firstName[0] ?? '?').toUpperCase()}
                </Text>
              </View>
            )}
            <LinearGradient
              colors={gradients.interactive}
              style={styles.cameraBtn}
            >
              <Ionicons name="camera" size={15} color={colors.mistWhite} />
            </LinearGradient>
          </Pressable>
          <Text style={styles.changePhotoText}>{t('tapToChangePhoto')}</Text>
          {!!displayImageUri && (
            <Pressable onPress={handleDeletePhoto} hitSlop={8} style={{ marginTop: 4 }}>
              <Text style={styles.deletePhotoText}>{t('deletePhoto')}</Text>
            </Pressable>
          )}
        </View>

        {/* ── Personal Information ── */}
        <Text style={styles.sectionLabel}>{t('personalInformation')}</Text>
        <View style={styles.card}>
          <View style={fieldStyles.fieldSpacing}>
            <FormField label={t('firstName')} value={firstName} onChangeText={setFirstName} placeholder={t('enterFirstName')} />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField label={t('lastName')} value={lastName} onChangeText={setLastName} placeholder={t('enterLastName')} />
          </View>

          {/* Gender */}
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label={t('gender')}
              value={gender ? t(GENDER_LABEL_MAP[gender] ?? 'gender') : ''}
              placeholder={t('selectGender')}
              onPress={() => setShowGenderPicker(true)}
              suffix={<Ionicons name="chevron-down" size={16} color="#9CA3AF" />}
            />
          </View>

          {/* Date of Birth */}
          <FormField
            label={t('dateOfBirth')}
            value={dobLabel}
            placeholder={t('selectDateOfBirth')}
            onPress={() => setShowDatePicker(true)}
            suffix={<Ionicons name="calendar-outline" size={16} color="#9CA3AF" />}
          />
          {!!dobError && <Text style={fieldStyles.errorText}>{dobError}</Text>}
          {!dobError && <View style={{ height: 14 }} />}
        </View>

        {/* ── Contact Information ── */}
        <Text style={styles.sectionLabel}>{t('contactInformation')}</Text>
        <View style={styles.card}>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label={t('phoneNumber')}
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. +251 91 234 5678"
              keyboardType="phone-pad"
            />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label={t('emailAddress')}
              value={user?.primaryEmailAddress?.emailAddress ?? ''}
              onPress={() => setShowChangeEmail(true)}
              suffix={<Text style={styles.changeLinkText}>{t('change')}</Text>}
            />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label={t('country')}
              value={country}
              placeholder={t('selectCountry')}
              onPress={() => setShowCountryPicker(true)}
              suffix={<Ionicons name="chevron-down" size={16} color="#9CA3AF" />}
            />
          </View>
          <FormField
            label={t('address')}
            value={address}
            onChangeText={setAddress}
            placeholder={t('enterAddress')}
            multiline
          />
        </View>

        {/* Save button */}
        <Pressable
          style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]}
          onPress={guardNav(handleSave)}
          disabled={saving}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.saveGrad}
          >
            <Text style={styles.saveText}>{saving ? t('saving') : t('saveChanges')}</Text>
          </LinearGradient>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modals */}
      <DatePickerModal
        visible={showDatePicker}
        value={dob}
        onConfirm={(v) => {
          setDob(v)
          setDobError('')
          setShowDatePicker(false)
        }}
        onCancel={() => setShowDatePicker(false)}
      />
      <GenderPickerModal
        visible={showGenderPicker}
        selected={gender}
        onSelect={setGender}
        onClose={() => setShowGenderPicker(false)}
      />
      <CountryPickerModal
        visible={showCountryPicker}
        selected={country}
        onSelect={setCountry}
        onClose={() => setShowCountryPicker(false)}
      />
      <ChangeEmailModal
        visible={showChangeEmail}
        onClose={() => setShowChangeEmail(false)}
        onSuccess={() => {
          setShowChangeEmail(false)
          user?.reload()
          Alert.alert(t('profileSaved'), t('emailUpdatedMsg'))
        }}
      />
      <PhotoPickerModal
        visible={showPhotoPicker}
        onCamera={() => handlePickPhoto('camera')}
        onGallery={() => handlePickPhoto('gallery')}
        onClose={() => setShowPhotoPicker(false)}
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.inkBlack,
  },

  avatarSection: { alignItems: 'center', paddingVertical: 20 },
  avatarWrap: { position: 'relative', marginBottom: 10 },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.careBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 34, color: colors.mistWhite },
  cameraBtn: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.mistWhite,
  },
  changePhotoText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.tealGreen,
  },
  deletePhotoText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.error,
  },
  changeLinkText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.tealGreen,
  },

  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    ...shadow('#000', 0, 1, 6, 0.05, 2),
  },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
