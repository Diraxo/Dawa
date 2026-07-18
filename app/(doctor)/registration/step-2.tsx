import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

const MAX_BIO = 300

const LANGUAGES = [
  'Arabic', 'Amharic', 'English', 'French', 'Somali', 'Swahili',
  'Tigrinya', 'Oromo', 'Afar', 'Harari', 'Sidama', 'Wolaytta',
  'Turkish', 'Hindi', 'Urdu',
]

export default function RegistrationStep2() {
  const router = useRouter()
  const store = useDoctorStore()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [specialtiesList, setSpecialtiesList] = useState<string[]>([])

  useEffect(() => {
    const FALLBACK_SPECIALTIES = [
      'Cardiology', 'Dermatology', 'Emergency Medicine', 'Endocrinology',
      'Family Medicine', 'Gastroenterology', 'General Practice', 'Gynecology',
      'Internal Medicine', 'Nephrology', 'Neurology', 'Obstetrics',
      'Oncology', 'Ophthalmology', 'Orthopedics', 'Pediatrics',
      'Psychiatry', 'Pulmonology', 'Radiology', 'Surgery', 'Urology',
    ]
    supabase
      .from('specialties')
      .select('name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setSpecialtiesList(data?.length ? data.map(s => s.name) : FALLBACK_SPECIALTIES)
      })
  }, [])

  const [licenseNumber, setLicenseNumber] = useState(store.regLicenseNumber)
  const [specialty, setSpecialty] = useState(store.regSpecialty)
  const [experience, setExperience] = useState(store.regYearsOfExperience)
  const [hospital, setHospital] = useState(store.regHospitalName)
  const [bio, setBio] = useState(store.regBio)
  const [languages, setLanguages] = useState<string[]>(store.regLanguages)
  const [showSpecialtyPicker, setShowSpecialtyPicker] = useState(false)
  const [showLanguagePicker, setShowLanguagePicker] = useState(false)

  const isValid = licenseNumber.trim().length > 3 && specialty.length > 0 && hospital.trim().length > 1

  const handleNext = () => {
    store.updateReg({
      regLicenseNumber: licenseNumber,
      regSpecialty: specialty,
      regYearsOfExperience: experience,
      regHospitalName: hospital,
      regBio: bio,
      regLanguages: languages,
    })
    router.push('/(doctor)/registration/step-3')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Top row */}
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.stepLabel}>Step 2 of 4</Text>
        </View>

        <Text style={styles.title}>{t('yourCredentials')}</Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: '50%' }]} />
        </View>

        {/* License Number */}
        <Text style={styles.label}>{t('medicalLicenseNumber')}</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. MED-2024-XXXXX"
          placeholderTextColor="#9CA3AF"
          value={licenseNumber}
          onChangeText={setLicenseNumber}
          autoCapitalize="characters"
        />

        {/* Specialty */}
        <Text style={styles.label}>{t('specialty')}</Text>
        <Pressable onPress={() => setShowSpecialtyPicker(true)} style={styles.pickerBtn}>
          <Text style={[styles.pickerText, !specialty && styles.pickerPlaceholder]}>
            {specialty || t('selectSpecialty')}
          </Text>
          <Ionicons name="chevron-down" size={18} color="#6B7280" />
        </Pressable>

        {/* Years of Experience */}
        <Text style={styles.label}>{t('yearsOfExperience')}</Text>
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => setExperience((e) => Math.max(0, e - 1))}
            style={styles.stepperBtn}
          >
            <Ionicons name="remove" size={20} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.stepperValue}>
            <Text style={styles.stepperText}>{experience}</Text>
            <Text style={styles.stepperUnit}>{experience === 1 ? 'year' : 'years'}</Text>
          </View>
          <Pressable
            onPress={() => setExperience((e) => Math.min(50, e + 1))}
            style={styles.stepperBtn}
          >
            <Ionicons name="add" size={20} color={colors.inkBlack} />
          </Pressable>
        </View>

        {/* Hospital / Clinic */}
        <Text style={styles.label}>{t('hospitalClinicName')}</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Karamara Hospital"
          placeholderTextColor="#9CA3AF"
          value={hospital}
          onChangeText={setHospital}
        />

        {/* Short Bio */}
        <Text style={styles.label}>{t('shortBio')}</Text>
        <TextInput
          style={styles.bioInput}
          placeholder="Tell patients a little about yourself, your experience, and approach to care..."
          placeholderTextColor="#9CA3AF"
          value={bio}
          onChangeText={(t) => setBio(t.slice(0, MAX_BIO))}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{bio.length} / {MAX_BIO}</Text>

        {/* Languages Spoken */}
        <Text style={styles.label}>Languages Spoken</Text>
        <Pressable onPress={() => setShowLanguagePicker(true)} style={styles.pickerBtn}>
          <Text style={[styles.pickerText, languages.length === 0 && styles.pickerPlaceholder]} numberOfLines={1}>
            {languages.length > 0 ? languages.join(', ') : 'Select languages'}
          </Text>
          <Ionicons name="chevron-down" size={18} color="#6B7280" />
        </Pressable>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(32, insets.bottom + 16) }]}>
        <View style={styles.footerRow}>
          <View style={styles.backBtnWrap}>
            <OutlineButton label="← Back" onPress={() => router.back()} />
          </View>
          <View style={styles.nextBtnWrap}>
            <GradientButton label="Next →" onPress={handleNext} disabled={!isValid} />
          </View>
        </View>
      </View>

      {/* Specialty Picker Modal */}
      <Modal visible={showSpecialtyPicker} transparent animationType="slide" onRequestClose={() => setShowSpecialtyPicker(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowSpecialtyPicker(false)} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('selectSpecialty')}</Text>
            <ScrollView>
              {specialtiesList.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => { setSpecialty(s); setShowSpecialtyPicker(false) }}
                  style={[styles.specialtyItem, specialty === s && styles.specialtyItemSelected]}
                >
                  <Text style={[styles.specialtyItemText, specialty === s && styles.specialtyItemTextSelected]}>{s}</Text>
                  {specialty === s && <Ionicons name="checkmark" size={18} color={colors.tealGreen} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Language Picker Modal */}
      <Modal visible={showLanguagePicker} transparent animationType="slide" onRequestClose={() => setShowLanguagePicker(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowLanguagePicker(false)} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Languages Spoken</Text>
            <ScrollView>
              {LANGUAGES.map((lang) => {
                const selected = languages.includes(lang)
                return (
                  <Pressable
                    key={lang}
                    onPress={() => {
                      setLanguages(prev =>
                        prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
                      )
                    }}
                    style={[styles.specialtyItem, selected && styles.specialtyItemSelected]}
                  >
                    <Text style={[styles.specialtyItemText, selected && styles.specialtyItemTextSelected]}>{lang}</Text>
                    {selected && <Ionicons name="checkmark" size={18} color={colors.tealGreen} />}
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
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingHorizontal: 24, paddingTop: 12 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  stepLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, marginBottom: 16 },

  progressTrack: { height: 6, backgroundColor: colors.cloudGrey, borderRadius: 3, marginBottom: 28, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  label: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 8, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: colors.steelGrey,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack,
    backgroundColor: colors.mistWhite, marginBottom: 16,
  },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 16,
  },
  pickerText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  pickerPlaceholder: { color: '#9CA3AF' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 16 },
  stepperBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.steelGrey,
  },
  stepperValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  stepperText: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack },
  stepperUnit: { fontFamily: fonts.regular, fontSize: 15, color: '#6B7280' },

  bioInput: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack,
    minHeight: 110, marginBottom: 6,
  },
  charCount: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', textAlign: 'right', marginBottom: 16 },

  footer: { paddingHorizontal: 24, paddingTop: 12, backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  footerRow: { flexDirection: 'row', gap: 12 },
  backBtnWrap: { flex: 1 },
  nextBtnWrap: { flex: 2 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { backgroundColor: colors.mistWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '70%' },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 12 },
  specialtyItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  specialtyItemSelected: { backgroundColor: '#F0FDFB' },
  specialtyItemText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  specialtyItemTextSelected: { fontFamily: fonts.semiBold, color: colors.tealGreen },
})
