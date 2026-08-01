import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
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

const LANGUAGES = [
  'Arabic', 'Amharic', 'English', 'French', 'Somali', 'Swahili',
  'Tigrinya', 'Oromo', 'Afar', 'Harari', 'Sidama', 'Wolaytta',
  'Turkish', 'Hindi', 'Urdu',
]

import { ChangeEmailModal } from '@/components/ui/ChangeEmailModal'
import { colors } from '@/constants/colors'
import { COUNTRIES, getFlag } from '@/constants/countries'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { waitForModalDismiss } from '@/lib/imagePicker'
import { shadow } from '@/lib/shadow'
import { pushOwnNameToStream, pushOwnPhotoToStream } from '@/lib/stream'
import { sanitize } from '@/lib/sanitize'
import { getAuthClient, supabase } from '@/lib/supabase'

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  onPress,
  suffix,
}: {
  label: string
  value: string
  onChangeText?: (t: string) => void
  placeholder?: string
  multiline?: boolean
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']
  onPress?: () => void
  suffix?: React.ReactNode
}) {
  const content = (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.input, styles.inputRow, multiline && styles.inputMultiline]}>
        <TextInput
          style={[styles.inputText, { pointerEvents: onPress ? 'none' : 'auto' }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          editable={!onPress}
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          keyboardType={keyboardType}
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

function PhotoPickerModal({
  visible,
  hasPhoto,
  onGallery,
  onDelete,
  onClose,
}: {
  visible: boolean
  hasPhoto: boolean
  onGallery: () => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={modal.overlay} onPress={onClose}>
        <View style={modal.sheet}>
          <Text style={modal.title}>Change Profile Photo</Text>
          <TouchableOpacity style={modal.option} onPress={onGallery}>
            <View style={modal.iconWrap}>
              <Ionicons name="images-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={modal.optionText}>Choose from Gallery</Text>
          </TouchableOpacity>
          {hasPhoto && (
            <>
              <View style={modal.divider} />
              <TouchableOpacity style={modal.option} onPress={onDelete}>
                <View style={modal.iconWrap}>
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                </View>
                <Text style={[modal.optionText, { color: colors.error }]}>Delete Photo</Text>
              </TouchableOpacity>
            </>
          )}
          <View style={modal.divider} />
          <TouchableOpacity style={[modal.option, { justifyContent: 'center' }]} onPress={onClose}>
            <Text style={[modal.optionText, { color: colors.error }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  )
}

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 34, paddingTop: 16,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  optionText: { fontFamily: fonts.medium, fontSize: 16, color: colors.inkBlack },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 52 },
})

export default function EditDoctorProfileScreen() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const router = useRouter()
  const { photoUrl: dbPhotoUrl, refresh: refreshPhoto } = useOwnProfilePhoto()
  const guardNav = useNavGuard()

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [bio, setBio] = useState('')
  const [hospitalName, setHospitalName] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [showLanguagePicker, setShowLanguagePicker] = useState(false)
  const [localImageUri, setLocalImageUri] = useState<string | null>(null)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  // Snapshots of last-saved values so handleSave can tell exactly which
  // concern (name, photo, professional details) actually changed and only
  // touch that concern — an edit to one field must never run, or surface
  // errors for, an unrelated field.
  const [initialFirstName, setInitialFirstName] = useState(user?.firstName ?? '')
  const [initialLastName, setInitialLastName] = useState(user?.lastName ?? '')
  const [initialPhone, setInitialPhone] = useState('')
  const [initialCountry, setInitialCountry] = useState('')
  const [initialBio, setInitialBio] = useState('')
  const [initialHospitalName, setInitialHospitalName] = useState('')
  const [initialLanguages, setInitialLanguages] = useState<string[]>([])
  const [dbUserId, setDbUserId] = useState<string | null>(null)
  const [headerHeight, setHeaderHeight] = useState(60)

  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('users')
      .select('id, phone, country')
      .eq('clerk_id', user.id)
      .single()
      .then(({ data: userRow }) => {
        if (!userRow) return
        setDbUserId((userRow as any).id ?? null)
        setPhone((userRow as any).phone ?? '')
        setInitialPhone((userRow as any).phone ?? '')
        setCountry((userRow as any).country ?? '')
        setInitialCountry((userRow as any).country ?? '')

        getToken().then(async (token) => {
          if (!token) return
          // doctor_profiles SELECT RLS returns own row + every approved
          // doctor's row (for patient browsing), so this must be filtered
          // to the caller's own row or .single() throws once any other
          // approved doctor exists — silently leaving these fields blank.
          const { data } = await getAuthClient(token)
            .from('doctor_profiles')
            .select('bio, hospital_name, languages')
            .eq('user_id', (userRow as any).id)
            .single()
          if (data) {
            setBio((data as any).bio ?? '')
            setHospitalName((data as any).hospital_name ?? '')
            setLanguages((data as any).languages ?? [])
            setInitialBio((data as any).bio ?? '')
            setInitialHospitalName((data as any).hospital_name ?? '')
            setInitialLanguages((data as any).languages ?? [])
          }
        })
      })
  }, [user?.id])

  const handlePickPhoto = async () => {
    setShowPhotoPicker(false)
    await waitForModalDismiss()
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed.')
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      if (!result.canceled && result.assets[0]) setLocalImageUri(result.assets[0].uri)
    } catch (e) {
      console.error('Gallery picker failed:', e)
      Alert.alert('Error', 'Could not open the photo library. Please try again.')
    }
  }

  const handleSave = async () => {
    if (!user?.id) return

    const nameChanged = firstName !== initialFirstName || lastName !== initialLastName
    const phoneChanged = phone !== initialPhone
    const countryChanged = country !== initialCountry
    const photoChanged = !!localImageUri
    const professionalChanged =
      bio !== initialBio ||
      hospitalName !== initialHospitalName ||
      languages.join(',') !== initialLanguages.join(',')

    if (!nameChanged && !phoneChanged && !countryChanged && !photoChanged && !professionalChanged) {
      router.back()
      return
    }

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Error', 'Please enter your first and last name.')
      return
    }
    const phoneDigits = phone.replace(/[^0-9]/g, '')
    if (phone.trim() && (phoneDigits.length < 6 || /[^0-9+\-() ]/.test(phone.trim()))) {
      Alert.alert('Error', 'Please enter a valid phone number.')
      return
    }

    setSaving(true)
    try {
      // Each concern is committed to its own system independently. If a later
      // concern fails, earlier ones that already succeeded must stay
      // committed (both remotely and in local `initial*` state) instead of
      // being silently retried or reported as if nothing saved — otherwise a
      // partial failure looks like data "reverting" on next load.
      //
      // The name itself is a two-phase write (Clerk, then mirrored onto
      // users.full_name below) — `initial*` is only committed once BOTH
      // sides agree, and if the users-table write fails, Clerk is rolled
      // back to these captured values so the two systems can never
      // permanently disagree about the doctor's name.
      const previousFirstName = initialFirstName
      const previousLastName = initialLastName
      // Strip HTML/script-breakout characters before anything is persisted —
      // this utility previously existed but was never wired up anywhere.
      const cleanFirstName = sanitize.text(firstName)
      const cleanLastName = sanitize.text(lastName)
      const cleanBio = sanitize.text(bio)
      const cleanHospitalName = sanitize.text(hospitalName)
      if (nameChanged) {
        try {
          await user.update({ firstName: cleanFirstName, lastName: cleanLastName })
        } catch (e) {
          console.error('Failed to update name (Clerk):', e)
          throw new Error('Could not update your name. Please try again.')
        }
      }

      const token = await getToken()
      if (!token) throw new Error('No token')
      const client = getAuthClient(token)

      // Photo upload only ever runs if the doctor actually picked a new
      // photo this session — a name/phone/bio-only save must never touch
      // storage or be able to surface a photo error.
      let profilePhotoUrl: string | null = null
      let photoUploadFailed = false
      const avatarPath = `${user.id}/avatar.jpg`
      if (photoChanged) {
        // Upload the new photo first (upsert overwrites avatar.jpg
        // atomically) and only touch anything else once that succeeds — if
        // upload fails, the existing avatar must be left completely alone.
        // Cleanup of any stale differently-named files (older flows used
        // different filenames) is deferred until after the DB row itself is
        // updated below, so a crash mid-save can never leave the doctor with
        // no photo at all.
        try {
          const response = await fetch(localImageUri!)
          const arrayBuffer = await response.arrayBuffer()
          const { error: uploadError } = await client.storage
            .from('profile-photos')
            .upload(avatarPath, arrayBuffer, { contentType: 'image/jpeg', upsert: true })
          if (uploadError) throw uploadError
          const { data: urlData } = client.storage.from('profile-photos').getPublicUrl(avatarPath)
          profilePhotoUrl = `${urlData.publicUrl}?v=${Date.now()}`
        } catch (e) {
          console.error('Failed to upload profile photo:', e)
          photoUploadFailed = true
        }
      }

      if (phoneChanged || countryChanged || profilePhotoUrl || nameChanged) {
        const { error: userError } = await client
          .from('users')
          .update({
            full_name: `${cleanFirstName} ${cleanLastName}`.trim(),
            phone,
            country,
            ...(profilePhotoUrl ? { profile_photo_url: profilePhotoUrl } : {}),
          })
          .eq('clerk_id', user.id)
        if (userError) {
          console.error('Failed to update users row (phone/country/photo):', userError)
          if (nameChanged) {
            await user.update({ firstName: previousFirstName, lastName: previousLastName }).catch((e) => {
              console.error('Failed to roll back Clerk name after users-table write failure:', e)
            })
          }
          throw new Error(
            phoneChanged
              ? 'Could not update your phone number. Please try again.'
              : 'Could not save your changes. Please try again.'
          )
        }
        if (nameChanged) {
          setInitialFirstName(cleanFirstName)
          setInitialLastName(cleanLastName)
        }
        setInitialPhone(phone)
        setInitialCountry(country)

        if (profilePhotoUrl) {
          // Only now that the new photo is uploaded and the DB row points
          // at it is it safe to clean up any stale, differently-named files
          // left behind by older flows (registration vs. this screen).
          try {
            const { data: existing } = await client.storage.from('profile-photos').list(user.id)
            const stale = (existing ?? []).filter((f) => f.name !== 'avatar.jpg')
            if (stale.length > 0) {
              await client.storage.from('profile-photos').remove(stale.map((f) => `${user.id}/${f.name}`))
            }
          } catch (e) {
            console.error('Failed to clean up stale profile photo file(s):', e)
          }
        }
      }

      // Professional-details update only runs when those fields actually
      // changed, so a name-only save can't fail on an unrelated RLS/row-match
      // issue in doctor_profiles.
      if (professionalChanged) {
        const { data: updatedRows, error: profileError } = await client
          .from('doctor_profiles')
          .update({ bio: cleanBio, hospital_name: cleanHospitalName, languages })
          .eq('user_id', dbUserId)
          .select('id')
        if (profileError) {
          console.error('Failed to update doctor_profiles (bio/hospital/languages):', profileError)
          throw new Error('Could not save your professional details. Please try again.')
        }
        if (!updatedRows || updatedRows.length === 0) {
          console.error('doctor_profiles update matched 0 rows for user_id:', dbUserId)
          throw new Error('Could not save your professional details. Please try again.')
        }
        setInitialBio(cleanBio)
        setInitialHospitalName(cleanHospitalName)
        setInitialLanguages(languages)
      }

      if (photoChanged) setLocalImageUri(null)
      refreshPhoto()
      if (profilePhotoUrl) pushOwnPhotoToStream(profilePhotoUrl)
      if (nameChanged) pushOwnNameToStream(`${cleanFirstName} ${cleanLastName}`.trim())

      if (photoChanged && photoUploadFailed) {
        Alert.alert('Saved with a Problem', 'Your profile was updated, but the photo failed to upload. Please try again.')
      } else {
        Alert.alert('Saved', 'Your profile has been updated.')
      }
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePhoto = () => {
    setShowPhotoPicker(false)
    if (!user?.id) return
    Alert.alert(
      'Delete profile photo?',
      'Are you sure you want to delete your profile photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDeletePhoto },
      ]
    )
  }

  const confirmDeletePhoto = async () => {
    if (!user?.id) return
    try {
      const token = await getToken()
      if (!token) throw new Error('No token')
      const client = getAuthClient(token)
      const { data: existing } = await client.storage.from('profile-photos').list(user.id)
      if (existing && existing.length > 0) {
        await client.storage.from('profile-photos').remove(existing.map((f) => `${user.id}/${f.name}`))
      }
      await client.from('users').update({ profile_photo_url: null }).eq('clerk_id', user.id)
      setLocalImageUri(null)
      refreshPhoto()
      pushOwnPhotoToStream(null)
    } catch {
      Alert.alert('Error', 'Failed to delete photo. Please try again.')
    }
  }

  const displayImage = localImageUri ?? dbPhotoUrl ?? user?.imageUrl
  // OAuth-provider avatar URLs (Clerk's imageUrl, when there's no uploaded
  // photo) can expire or 404 without any DB-side signal — fall back to the
  // initials placeholder instead of a permanently broken image.
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  useEffect(() => { setAvatarLoadFailed(false) }, [displayImage])
  const initial = (firstName[0] ?? 'D').toUpperCase()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
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
            <Pressable style={styles.avatarWrap} onPress={() => setShowPhotoPicker(true)}>
              {displayImage && !avatarLoadFailed ? (
                <Image
                  source={{ uri: displayImage }}
                  style={styles.avatar}
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
              <LinearGradient colors={gradients.interactive} style={styles.cameraBtn}>
                <Ionicons name="camera" size={15} color={colors.mistWhite} />
              </LinearGradient>
            </Pressable>
            <Text style={styles.changePhotoText}>Tap to change photo</Text>
          </View>

          <Text style={styles.sectionLabel}>Personal Information</Text>
          <View style={styles.card}>
            <FormField label="First Name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
            <View style={styles.fieldSpacing} />
            <FormField label="Last Name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
            <View style={styles.fieldSpacing} />
            <FormField label="Phone Number" value={phone} onChangeText={setPhone} placeholder="+251 91 234 5678" keyboardType="phone-pad" />
            <View style={styles.fieldSpacing} />
            <FormField
              label="Email Address"
              value={user?.primaryEmailAddress?.emailAddress ?? ''}
              onPress={() => setShowChangeEmail(true)}
              suffix={<Text style={styles.changeLinkText}>Change</Text>}
            />
            <View style={styles.fieldSpacing} />
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Country</Text>
              <View style={[styles.input, styles.inputRow]}>
                <Text style={styles.countryFlag}>
                  {getFlag(COUNTRIES.find((c) => c.name === country)?.id ?? '')}
                </Text>
                <Text style={styles.inputText}>{country || '—'}</Text>
                <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
              </View>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Professional Details</Text>
          <View style={styles.card}>
            <FormField label="Hospital / Clinic Name" value={hospitalName} onChangeText={setHospitalName} placeholder="e.g. St. Paul's Hospital" />
            <View style={styles.fieldSpacing} />
            <FormField label="Bio" value={bio} onChangeText={setBio} placeholder="A brief description about yourself..." multiline />
            <View style={styles.fieldSpacing} />
            <Text style={styles.fieldLabel}>Languages Spoken</Text>
            <Pressable
              onPress={() => setShowLanguagePicker(true)}
              style={styles.langPickerBtn}
            >
              <Text style={[styles.langPickerText, languages.length === 0 && styles.langPickerPlaceholder]} numberOfLines={1}>
                {languages.length > 0 ? languages.join(', ') : 'Select languages'}
              </Text>
              <Ionicons name="chevron-down" size={18} color="#6B7280" />
            </Pressable>
          </View>

          <Pressable style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]} onPress={guardNav(handleSave)} disabled={saving}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveGrad}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </LinearGradient>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoPickerModal
        visible={showPhotoPicker}
        hasPhoto={!!displayImage}
        onGallery={handlePickPhoto}
        onDelete={handleDeletePhoto}
        onClose={() => setShowPhotoPicker(false)}
      />

      <ChangeEmailModal
        visible={showChangeEmail}
        onClose={() => setShowChangeEmail(false)}
        onSuccess={() => {
          setShowChangeEmail(false)
          user?.reload()
          Alert.alert('Saved', 'Your email address has been updated.')
        }}
      />

      {/* Language Picker Modal */}
      <Modal visible={showLanguagePicker} transparent animationType="slide" onRequestClose={() => setShowLanguagePicker(false)}>
        <View style={langModal.overlay}>
          <Pressable style={langModal.backdrop} onPress={() => setShowLanguagePicker(false)} />
          <View style={langModal.sheet}>
            <View style={langModal.handle} />
            <Text style={langModal.title}>Languages Spoken</Text>
            <ScrollView>
              {LANGUAGES.map((lang) => {
                const selected = languages.includes(lang)
                return (
                  <Pressable
                    key={lang}
                    onPress={() =>
                      setLanguages(prev =>
                        prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
                      )
                    }
                    style={[langModal.item, selected && langModal.itemSelected]}
                  >
                    <Text style={[langModal.itemText, selected && langModal.itemTextSelected]}>{lang}</Text>
                    {selected && <Ionicons name="checkmark" size={18} color="#00BFA5" />}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  avatarSection: { alignItems: 'center', paddingVertical: 20 },
  avatarWrap: { position: 'relative', marginBottom: 10 },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarFallback: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.bold, fontSize: 34, color: colors.mistWhite },
  cameraBtn: { position: 'absolute', bottom: 2, right: 2, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.mistWhite },
  changePhotoText: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen },
  changeLinkText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.tealGreen },

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, ...shadow('#000', 0, 1, 6, 0.05, 2) },
  fieldWrap: { marginBottom: 0 },
  fieldSpacing: { height: 16 },
  fieldLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#374151', marginBottom: 7 },
  input: { backgroundColor: colors.cloudGrey, borderRadius: 12, borderWidth: 1, borderColor: colors.steelGrey, paddingHorizontal: 14, height: 50 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  inputText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack, padding: 0 },
  inputMultiline: { height: 100, paddingTop: 12, paddingBottom: 12, alignItems: 'flex-start' },
  countryFlag: { fontSize: 18, marginRight: 8 },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },

  langPickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.cloudGrey, borderRadius: 12,
    borderWidth: 1, borderColor: colors.steelGrey,
    paddingHorizontal: 14, height: 50,
  },
  langPickerText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack, flex: 1, marginRight: 8 },
  langPickerPlaceholder: { color: '#9CA3AF' },
})

const langModal = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '70%' },
  handle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 12 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  itemSelected: { backgroundColor: '#F0FDFB' },
  itemText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  itemTextSelected: { fontFamily: fonts.semiBold, color: '#00BFA5' },
})
