import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

export default function MySpecialtiesScreen() {
  const { getToken } = useAuth()
  const router = useRouter()

  const [specialty, setSpecialty] = useState('')
  const [yearsExp, setYearsExp] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [specialties, setSpecialties] = useState<string[]>([])

  useEffect(() => {
    // Load admin-managed specialties and doctor's current profile in parallel
    Promise.all([
      supabase.from('specialties').select('name').order('name'),
      getToken().then(token =>
        token
          ? getAuthClient(token)
              .from('doctor_profiles')
              .select('specialty, years_experience, license_number')
              .single()
          : { data: null }
      ),
    ]).then(([specsRes, profileRes]) => {
      setSpecialties((specsRes.data ?? []).map((s: any) => s.name as string))
      if (profileRes.data) {
        setSpecialty((profileRes.data as any).specialty ?? '')
        setYearsExp(String((profileRes.data as any).years_experience ?? ''))
        setLicenseNumber((profileRes.data as any).license_number ?? '')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    const yearsNum = Number(yearsExp)
    if (!specialty.trim()) {
      Alert.alert('Required', 'Please select a specialty.')
      return
    }
    if (isNaN(yearsNum) || yearsNum < 0) {
      Alert.alert('Invalid', 'Please enter valid years of experience.')
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('No token')
      const { data: updatedRows, error } = await getAuthClient(token)
        .from('doctor_profiles')
        .update({ specialty: specialty.trim(), years_experience: yearsNum })
        .select('id')
      if (error) throw error
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('No doctor profile row matched — nothing was saved.')
      }
      Alert.alert('Saved', 'Your specialties have been updated.')
      router.back()
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Specialties & Tags</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Medical Specialty</Text>
          <View style={styles.card}>
            <Pressable style={styles.pickerRow} onPress={() => setShowPicker((v) => !v)}>
              <Text style={[styles.pickerValue, !specialty && { color: '#9CA3AF' }]}>
                {specialty || 'Select specialty'}
              </Text>
              <Ionicons name={showPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
            </Pressable>
            {showPicker && (
              <View style={styles.pickerList}>
                {specialties.length === 0 ? (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#9CA3AF' }}>No specialties available</Text>
                  </View>
                ) : specialties.map((s, idx) => (
                  <View key={s}>
                    <Pressable
                      style={({ pressed }) => [styles.pickerItem, pressed && { backgroundColor: '#F9FAFB' }]}
                      onPress={() => { setSpecialty(s); setShowPicker(false) }}
                    >
                      <Text style={[styles.pickerItemText, specialty === s && styles.pickerItemTextSel]}>{s}</Text>
                      {specialty === s && <Ionicons name="checkmark" size={18} color={colors.tealGreen} />}
                    </Pressable>
                    {idx < specialties.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            )}
          </View>

          <Text style={styles.sectionLabel}>Professional Details</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Years of Experience</Text>
            <TextInput
              style={styles.input}
              value={yearsExp}
              onChangeText={setYearsExp}
              keyboardType="numeric"
              placeholder="e.g. 5"
              placeholderTextColor="#9CA3AF"
            />
            <View style={{ height: 16 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.fieldLabel}>Medical License Number</Text>
              <Ionicons name="lock-closed" size={13} color="#9CA3AF" />
            </View>
            {/* Read-only — matches the website, which locks this post-verification
                so a doctor can't self-service change a credential admin approved. */}
            <View style={[styles.input, { justifyContent: 'center' }]}>
              <Text style={{ fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack }}>
                {licenseNumber || '—'}
              </Text>
            </View>
            <Text style={styles.lockedNote}>To update this, contact support@dawa.app.</Text>
          </View>

          <Pressable style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]} onPress={handleSave} disabled={saving}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveGrad}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </LinearGradient>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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

  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 20, ...shadow('#000', 0, 1, 6, 0.05, 2) },

  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerValue: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkBlack, flex: 1 },
  pickerList: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4 },
  pickerItemText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack },
  pickerItemTextSel: { fontFamily: fonts.semiBold, color: colors.tealGreen },
  divider: { height: 1, backgroundColor: colors.cloudGrey },

  fieldLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#374151', marginBottom: 7 },
  input: { backgroundColor: colors.cloudGrey, borderRadius: 12, borderWidth: 1, borderColor: colors.steelGrey, paddingHorizontal: 14, height: 50, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  lockedNote: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginTop: 6 },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  saveGrad: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
