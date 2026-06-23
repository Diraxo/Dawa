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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (t: string) => void
  placeholder?: string
  multiline?: boolean
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

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
      <Pressable style={modal.overlay} onPress={onClose}>
        <View style={modal.sheet}>
          <Text style={modal.title}>Change Profile Photo</Text>
          <TouchableOpacity style={modal.option} onPress={onCamera}>
            <View style={modal.iconWrap}>
              <Ionicons name="camera-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={modal.optionText}>Take Photo</Text>
          </TouchableOpacity>
          <View style={modal.divider} />
          <TouchableOpacity style={modal.option} onPress={onGallery}>
            <View style={modal.iconWrap}>
              <Ionicons name="images-outline" size={22} color={colors.inkBlack} />
            </View>
            <Text style={modal.optionText}>Choose from Gallery</Text>
          </TouchableOpacity>
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

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [hospitalName, setHospitalName] = useState('')
  const [localImageUri, setLocalImageUri] = useState<string | null>(null)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('users')
      .select('phone')
      .eq('clerk_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setPhone(data.phone ?? '')
      })

    getToken().then(async (token) => {
      if (!token) return
      const { data } = await getAuthClient(token)
        .from('doctor_profiles')
        .select('bio, hospital_name')
        .single()
      if (data) {
        setBio((data as any).bio ?? '')
        setHospitalName((data as any).hospital_name ?? '')
      }
    })
  }, [user?.id])

  const handlePickPhoto = async (source: 'camera' | 'gallery') => {
    setShowPhotoPicker(false)
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take a photo.')
        return
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      if (!result.canceled && result.assets[0]) setLocalImageUri(result.assets[0].uri)
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed.')
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      if (!result.canceled && result.assets[0]) setLocalImageUri(result.assets[0].uri)
    }
  }

  const handleSave = async () => {
    if (!user?.id) return
    setSaving(true)
    try {
      await user.update({ firstName, lastName })

      let profilePhotoUrl: string | null = null
      if (localImageUri) {
        try {
          const response = await fetch(localImageUri)
          const arrayBuffer = await response.arrayBuffer()
          const fileName = `${user.id}.jpg`
          await supabase.storage.from('avatars').upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: true })
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName)
          profilePhotoUrl = urlData.publicUrl
        } catch {
          // Photo upload failed — save rest anyway
        }
      }

      const token = await getToken()
      if (!token) throw new Error('No token')
      const client = getAuthClient(token)

      await client.from('users').upsert(
        {
          clerk_id: user.id,
          full_name: `${firstName} ${lastName}`.trim(),
          phone,
          ...(profilePhotoUrl ? { profile_photo_url: profilePhotoUrl } : {}),
        },
        { onConflict: 'clerk_id' }
      )

      await client.from('doctor_profiles').update({ bio, hospital_name: hospitalName })

      Alert.alert('Saved', 'Your profile has been updated.')
      router.back()
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const displayImage = localImageUri ?? user?.imageUrl
  const initial = (firstName[0] ?? 'D').toUpperCase()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <Pressable style={styles.avatarWrap} onPress={() => setShowPhotoPicker(true)}>
              {displayImage ? (
                <Image source={{ uri: displayImage }} style={styles.avatar} />
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
          </View>

          <Text style={styles.sectionLabel}>Professional Details</Text>
          <View style={styles.card}>
            <FormField label="Hospital / Clinic Name" value={hospitalName} onChangeText={setHospitalName} placeholder="e.g. St. Paul's Hospital" />
            <View style={styles.fieldSpacing} />
            <FormField label="Bio" value={bio} onChangeText={setBio} placeholder="A brief description about yourself..." multiline />
          </View>

          <Pressable style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]} onPress={handleSave} disabled={saving}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveGrad}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </LinearGradient>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoPickerModal
        visible={showPhotoPicker}
        onCamera={() => handlePickPhoto('camera')}
        onGallery={() => handlePickPhoto('gallery')}
        onClose={() => setShowPhotoPicker(false)}
      />
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

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, ...shadow('#000', 0, 1, 6, 0.05, 2) },
  fieldWrap: { marginBottom: 0 },
  fieldSpacing: { height: 16 },
  fieldLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#374151', marginBottom: 7 },
  input: { backgroundColor: colors.cloudGrey, borderRadius: 12, borderWidth: 1, borderColor: colors.steelGrey, paddingHorizontal: 14, height: 50, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  inputMultiline: { height: 100, paddingTop: 12, paddingBottom: 12 },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
