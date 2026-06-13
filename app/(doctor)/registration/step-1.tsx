import { useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  Image,
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
import { supabaseEmailAuth } from '@/lib/supabase'
import { type Gender, useDoctorStore } from '@/store/doctorStore'

const GENDERS: Gender[] = ['Male', 'Female', 'Other']

export default function RegistrationStep1() {
  const router = useRouter()
  const { user } = useUser()
  const { updateReg, regFullName, regPhone, regDateOfBirth, regGender, regProfilePhotoUri } = useDoctorStore()

  const [fullName, setFullName] = useState(regFullName)

  // Pre-fill name if the store has no saved name yet.
  // Clerk user (Google/Facebook OAuth) → use user.fullName
  // Supabase email user → read from user_metadata.full_name set during sign-up
  useEffect(() => {
    if (fullName) return
    if (user?.fullName) {
      setFullName(user.fullName)
      return
    }
    supabaseEmailAuth.auth.getUser().then(({ data: { user: supaUser } }) => {
      const name = supaUser?.user_metadata?.full_name as string | undefined
      if (name) setFullName(name)
    })
  }, [user?.fullName])
  const [phone, setPhone] = useState(regPhone)
  const [dob, setDob] = useState(regDateOfBirth)
  const [gender, setGender] = useState<Gender | null>(regGender)
  const [photoUri, setPhotoUri] = useState<string | null>(regProfilePhotoUri)

  const isValid = fullName.trim().length > 1 && phone.trim().length > 5 && dob.length >= 6 && gender !== null

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photos.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri)
    }
  }

  const handleNext = () => {
    updateReg({ regFullName: fullName, regPhone: phone, regDateOfBirth: dob, regGender: gender, regProfilePhotoUri: photoUri })
    router.push('/(doctor)/registration/step-2')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Top row */}
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.stepLabel}>Step 1 of 4</Text>
        </View>

        <Text style={styles.title}>Create Your Profile</Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: '25%' }]} />
        </View>

        {/* Profile photo */}
        <View style={styles.photoSection}>
          <Pressable onPress={handlePickPhoto} style={styles.photoCircle}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoImage} />
            ) : (
              <>
                <View style={styles.cameraIconBg}>
                  <Ionicons name="camera" size={30} color={colors.careBlue} />
                </View>
                <Text style={styles.photoHint}>Tap to add photo</Text>
              </>
            )}
          </Pressable>
          {photoUri && (
            <Pressable onPress={handlePickPhoto} style={styles.changePhotoBtn}>
              <Text style={styles.changePhotoText}>Change photo</Text>
            </Pressable>
          )}
        </View>

        {/* Full Name */}
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Dr. Jane Smith"
          placeholderTextColor="#9CA3AF"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        {/* Phone Number */}
        <Text style={styles.label}>Phone Number</Text>
        <View style={styles.phoneRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryCodeText}>+251</Text>
          </View>
          <TextInput
            style={[styles.input, styles.phoneInput]}
            placeholder="912 345 678"
            placeholderTextColor="#9CA3AF"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        {/* Date of Birth */}
        <Text style={styles.label}>Date of Birth</Text>
        <TextInput
          style={styles.input}
          placeholder="DD/MM/YYYY"
          placeholderTextColor="#9CA3AF"
          value={dob}
          onChangeText={setDob}
          keyboardType="numeric"
          maxLength={10}
        />

        {/* Gender */}
        <Text style={styles.label}>Gender</Text>
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
        <GradientButton label="Next →" onPress={handleNext} disabled={!isValid} />
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
    marginBottom: 6,
  },
  photoHint: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  changePhotoBtn: { marginTop: 8 },
  changePhotoText: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen },

  label: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 8, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: colors.steelGrey,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
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

  genderRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  genderChipWrap: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  genderChip: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  genderChipUnselected: { backgroundColor: colors.cloudGrey, borderWidth: 1.5, borderColor: colors.steelGrey },
  genderText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#6B7280' },
  genderTextSelected: { color: colors.mistWhite },

  footer: { paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
})
