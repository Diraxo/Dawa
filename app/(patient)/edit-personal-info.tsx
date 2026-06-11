import { Ionicons } from '@expo/vector-icons'
import { useUser } from '@clerk/clerk-expo'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { MIN_AGE_PATIENT, meetsAgeRequirement } from '@/lib/ageValidation'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'

// ─── Constants ────────────────────────────────────────────────────────────────

const GENDERS = ['Male', 'Female', 'Prefer not to say']

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
      <View style={[wheelStyles.fade, wheelStyles.fadeTop]} pointerEvents="none" />
      <View style={[wheelStyles.fade, wheelStyles.fadeBottom]} pointerEvents="none" />
      <View style={wheelStyles.highlight} pointerEvents="none" />
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
            <Text style={dpStyles.title}>Date of Birth</Text>
            <Pressable onPress={onCancel} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.inkBlack} />
            </Pressable>
          </View>

          <View style={dpStyles.labels}>
            <Text style={[dpStyles.colLabel, { width: 64 }]}>Day</Text>
            <Text style={[dpStyles.colLabel, { flex: 1 }]}>Month</Text>
            <Text style={[dpStyles.colLabel, { width: 72 }]}>Year</Text>
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
              <Text style={dpStyles.confirmText}>Done</Text>
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
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={gpStyles.overlay} onPress={onClose}>
        <View style={gpStyles.card}>
          <Text style={gpStyles.title}>Select Gender</Text>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g}
              style={gpStyles.option}
              onPress={() => { onSelect(g); onClose() }}
            >
              <Text style={[gpStyles.optText, selected === g && gpStyles.optTextSel]}>
                {g}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
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
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={ppStyles.overlay} onPress={onClose}>
        <View style={ppStyles.sheet}>
          <Text style={ppStyles.title}>Change Profile Photo</Text>
          <Pressable style={ppStyles.option} onPress={onCamera}>
            <View style={ppStyles.iconWrap}>
              <Ionicons name="camera-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={ppStyles.optionText}>Take Photo</Text>
          </Pressable>
          <View style={ppStyles.divider} />
          <Pressable style={ppStyles.option} onPress={onGallery}>
            <View style={ppStyles.iconWrap}>
              <Ionicons name="images-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={ppStyles.optionText}>Choose from Gallery</Text>
          </Pressable>
          <View style={ppStyles.divider} />
          <Pressable style={[ppStyles.option, ppStyles.cancelOption]} onPress={onClose}>
            <Text style={ppStyles.cancelText}>Cancel</Text>
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
}: {
  label: string
  value: string
  onChangeText?: (t: string) => void
  placeholder?: string
  editable?: boolean
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']
  suffix?: React.ReactNode
  onPress?: () => void
}) {
  const content = (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={[fieldStyles.inputRow, !editable && fieldStyles.inputRowDisabled]}>
        <TextInput
          style={[fieldStyles.input, !editable && fieldStyles.inputDisabled]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          editable={editable && !onPress}
          keyboardType={keyboardType}
          pointerEvents={onPress ? 'none' : 'auto'}
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
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.inkBlack,
    padding: 0,
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
  const router = useRouter()
  const { selectedCountry } = useAppStore()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [phone, setPhone] = useState('')
  const [emailInput, setEmailInput] = useState(user?.primaryEmailAddress?.emailAddress ?? '')
  const [address, setAddress] = useState('')
  const [gender, setGender] = useState('')
  const [country, setCountry] = useState('')
  const [localImageUri, setLocalImageUri] = useState<string | null>(null)

  const defaultDob: DateValue = useMemo(() => ({ day: 1, month: 0, year: 10 }), [])
  const [dob, setDob] = useState<DateValue>(defaultDob)
  const [dobError, setDobError] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showGenderPicker, setShowGenderPicker] = useState(false)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  const dobLabel = useMemo(() => {
    if (dob === defaultDob) return ''
    return `${DAYS[dob.day - 1]} ${MONTHS[dob.month]} ${YEARS[dob.year]}`
  }, [dob, defaultDob])

  // Load existing profile from Supabase
  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('users')
      .select('phone, country, email')
      .eq('clerk_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPhone(data.phone ?? '')
          setCountry(data.country ?? selectedCountry ?? '')
          if (data.email) setEmailInput(data.email)
        } else {
          setCountry(selectedCountry ?? '')
        }
      })

    supabase
      .from('patient_profiles')
      .select('date_of_birth, gender, address')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setGender(data.gender ?? '')
          setAddress(data.address ?? '')
          if (data.date_of_birth) {
            const d = new Date(data.date_of_birth)
            setDob({
              day: d.getDate(),
              month: d.getMonth(),
              year: YEARS.indexOf(String(d.getFullYear())),
            })
          }
        }
      })
  }, [user?.id])

  // ── Image picker ─────────────────────────────────────────────────────────────

  const handlePickPhoto = async (source: 'camera' | 'gallery') => {
    setShowPhotoPicker(false)

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take a profile photo.')
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
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed to choose a photo.')
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
      }
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user?.id) return

    // Validate age
    if (dobLabel) {
      const birthDate = new Date(Number(YEARS[dob.year]), dob.month, dob.day)
      if (!meetsAgeRequirement(birthDate, 'patient')) {
        setDobError(`You must be at least ${MIN_AGE_PATIENT} years old to use CareHub as a patient.`)
        return
      }
    }
    setDobError('')

    setSaving(true)
    try {
      // Update Clerk name
      await user.update({ firstName, lastName })

      // Upload profile photo if a new one was picked
      let profilePhotoUrl: string | null = null
      if (localImageUri) {
        try {
          const response = await fetch(localImageUri)
          const arrayBuffer = await response.arrayBuffer()
          const fileName = `${user.id}.jpg`
          await supabase.storage
            .from('avatars')
            .upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: true })
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName)
          profilePhotoUrl = urlData.publicUrl
        } catch {
          // Photo upload failed — save rest of profile anyway
        }
      }

      // Upsert users table
      await supabase.from('users').upsert(
        {
          clerk_id: user.id,
          email: emailInput.trim() || user.primaryEmailAddress?.emailAddress,
          full_name: `${firstName} ${lastName}`.trim(),
          phone,
          country,
          ...(profilePhotoUrl ? { profile_photo_url: profilePhotoUrl } : {}),
        },
        { onConflict: 'clerk_id' }
      )

      // Build ISO date string
      const dobDate = dobLabel
        ? new Date(Number(YEARS[dob.year]), dob.month, dob.day).toISOString().split('T')[0]
        : null

      // Upsert patient_profiles
      await supabase.from('patient_profiles').upsert(
        { user_id: user.id, gender, date_of_birth: dobDate, address },
        { onConflict: 'user_id' }
      )

      Alert.alert('Saved', 'Your profile has been updated.')
      router.back()
    } catch {
      Alert.alert('Error', 'Failed to save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const displayImageUri = localImageUri ?? user?.imageUrl

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
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Pressable
            style={styles.avatarWrap}
            onPress={() => setShowPhotoPicker(true)}
          >
            {displayImageUri ? (
              <Image source={{ uri: displayImageUri }} style={styles.avatar} />
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
          <Text style={styles.changePhotoText}>Tap to change photo</Text>
        </View>

        {/* ── Personal Information ── */}
        <Text style={styles.sectionLabel}>Personal Information</Text>
        <View style={styles.card}>
          <View style={fieldStyles.fieldSpacing}>
            <FormField label="First Name" value={firstName} onChangeText={setFirstName} placeholder="Enter first name" />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField label="Last Name" value={lastName} onChangeText={setLastName} placeholder="Enter last name" />
          </View>

          {/* Gender */}
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label="Gender"
              value={gender}
              placeholder="Select gender"
              onPress={() => setShowGenderPicker(true)}
              suffix={<Ionicons name="chevron-down" size={16} color="#9CA3AF" />}
            />
          </View>

          {/* Date of Birth */}
          <FormField
            label="Date of Birth"
            value={dobLabel}
            placeholder="Select date of birth"
            onPress={() => setShowDatePicker(true)}
            suffix={<Ionicons name="calendar-outline" size={16} color="#9CA3AF" />}
          />
          {!!dobError && <Text style={fieldStyles.errorText}>{dobError}</Text>}
          {!dobError && <View style={{ height: 14 }} />}
        </View>

        {/* ── Contact Information ── */}
        <Text style={styles.sectionLabel}>Contact Information</Text>
        <View style={styles.card}>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label="Phone Number (Optional)"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. +251 91 234 5678"
              keyboardType="phone-pad"
            />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label="Email Address"
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="Enter email address"
              keyboardType="email-address"
            />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label="Country"
              value={country}
              editable={false}
              suffix={<Ionicons name="lock-closed" size={14} color="#9CA3AF" />}
            />
          </View>
          <View style={fieldStyles.fieldSpacing}>
            <FormField
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Enter your address"
            />
          </View>
        </View>

        {/* Save button */}
        <Pressable
          style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.saveGrad}
          >
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </LinearGradient>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
