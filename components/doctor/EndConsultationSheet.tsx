import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'

import { GradientButton } from '@/components/ui/GradientButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

interface Prescription {
  medicine: string
  dosage: string
  duration: string
  instructions: string
}

export interface ConsultationSummaryData {
  chiefComplaint: string
  diagnosis: string
  prescriptions: Prescription[]
  followUp: string
  referralNeeded: boolean
  referralSpecialty: string
}

interface Props {
  consultationId: string
  patientName: string
  onSubmit: (data: ConsultationSummaryData) => void
  onClose: () => void
}

const BLANK_RX: Prescription = { medicine: '', dosage: '', duration: '', instructions: '' }

export function EndConsultationSheet({ patientName, onSubmit, onClose }: Props) {
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [prescriptionEnabled, setPrescriptionEnabled] = useState(false)
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([{ ...BLANK_RX }])
  const [followUp, setFollowUp] = useState('')
  const [referralNeeded, setReferralNeeded] = useState(false)
  const [referralSpecialty, setReferralSpecialty] = useState('')

  const isValid = chiefComplaint.trim().length > 0 && diagnosis.trim().length > 0

  const updatePrescription = (index: number, field: keyof Prescription, value: string) => {
    setPrescriptions((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const handleSubmit = () => {
    if (!isValid) return
    onSubmit({
      chiefComplaint,
      diagnosis,
      prescriptions: prescriptionEnabled ? prescriptions : [],
      followUp,
      referralNeeded,
      referralSpecialty,
    })
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>End Consultation</Text>
          <Text style={styles.subtitle}>Fill in consultation notes for {patientName}</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fieldLabel}>Chief Complaint *</Text>
            <TextInput
              style={styles.input}
              placeholder="What did the patient report?"
              placeholderTextColor="#9CA3AF"
              value={chiefComplaint}
              onChangeText={setChiefComplaint}
              multiline
              textAlignVertical="top"
            />

            <Text style={styles.fieldLabel}>Diagnosis *</Text>
            <TextInput
              style={styles.input}
              placeholder="Your diagnosis"
              placeholderTextColor="#9CA3AF"
              value={diagnosis}
              onChangeText={setDiagnosis}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.toggleRow}>
              <Text style={styles.fieldLabel}>Add Prescription</Text>
              <Switch
                value={prescriptionEnabled}
                onValueChange={setPrescriptionEnabled}
                trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
                thumbColor={colors.mistWhite}
              />
            </View>

            {prescriptionEnabled && (
              <View style={styles.prescriptionCard}>
                {prescriptions.map((rx, i) => (
                  <View key={i}>
                    <TextInput
                      style={styles.smallInput}
                      placeholder="Medicine name"
                      placeholderTextColor="#9CA3AF"
                      value={rx.medicine}
                      onChangeText={(v) => updatePrescription(i, 'medicine', v)}
                    />
                    <View style={styles.rxRow}>
                      <TextInput
                        style={[styles.smallInput, styles.flex1]}
                        placeholder="Dosage"
                        placeholderTextColor="#9CA3AF"
                        value={rx.dosage}
                        onChangeText={(v) => updatePrescription(i, 'dosage', v)}
                      />
                      <TextInput
                        style={[styles.smallInput, styles.flex1]}
                        placeholder="Duration (e.g. 7 days)"
                        placeholderTextColor="#9CA3AF"
                        value={rx.duration}
                        onChangeText={(v) => updatePrescription(i, 'duration', v)}
                      />
                    </View>
                    <TextInput
                      style={styles.smallInput}
                      placeholder="Instructions (e.g. Take after meals)"
                      placeholderTextColor="#9CA3AF"
                      value={rx.instructions}
                      onChangeText={(v) => updatePrescription(i, 'instructions', v)}
                    />
                  </View>
                ))}
                <Pressable
                  onPress={() => setPrescriptions((prev) => [...prev, { ...BLANK_RX }])}
                  style={styles.addRxBtn}
                >
                  <Ionicons name="add-circle-outline" size={16} color={colors.tealGreen} />
                  <Text style={styles.addRxText}>+ Add Another Medicine</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.fieldLabel}>Follow-up Recommendation</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Return in 2 weeks if symptoms persist"
              placeholderTextColor="#9CA3AF"
              value={followUp}
              onChangeText={setFollowUp}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.toggleRow}>
              <Text style={styles.fieldLabel}>Referral Needed?</Text>
              <View style={styles.yesNoRow}>
                <Pressable
                  onPress={() => setReferralNeeded(true)}
                  style={[styles.yesNoChip, referralNeeded && styles.yesNoChipActive]}
                >
                  <Text style={[styles.yesNoText, referralNeeded && styles.yesNoTextActive]}>Yes</Text>
                </Pressable>
                <Pressable
                  onPress={() => setReferralNeeded(false)}
                  style={[styles.yesNoChip, !referralNeeded && styles.yesNoChipActive]}
                >
                  <Text style={[styles.yesNoText, !referralNeeded && styles.yesNoTextActive]}>No</Text>
                </Pressable>
              </View>
            </View>

            {referralNeeded && (
              <TextInput
                style={[styles.smallInput, { marginTop: 4 }]}
                placeholder="Specify specialty (e.g. Cardiology)"
                placeholderTextColor="#9CA3AF"
                value={referralSpecialty}
                onChangeText={setReferralSpecialty}
              />
            )}

            <View style={{ height: 16 }} />
          </ScrollView>

          <GradientButton
            label="Submit & End Consultation"
            onPress={handleSubmit}
            disabled={!isValid}
          />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '88%',
  },
  handle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, marginBottom: 4 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginBottom: 20 },
  scrollArea: { maxHeight: 440 },
  scrollContent: { paddingBottom: 8 },
  fieldLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 8, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack,
    minHeight: 80, marginBottom: 12, textAlignVertical: 'top',
  },
  smallInput: {
    borderWidth: 1.5, borderColor: colors.steelGrey, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack,
    marginBottom: 8,
  },
  flex1: { flex: 1 },
  rxRow: { flexDirection: 'row', gap: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  prescriptionCard: { backgroundColor: colors.cloudGrey, borderRadius: 12, padding: 12, marginBottom: 12 },
  addRxBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  addRxText: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen },
  yesNoRow: { flexDirection: 'row', gap: 8 },
  yesNoChip: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 99,
    borderWidth: 1.5, borderColor: colors.steelGrey, backgroundColor: colors.mistWhite,
  },
  yesNoChipActive: { backgroundColor: colors.tealGreen, borderColor: colors.tealGreen },
  yesNoText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#6B7280' },
  yesNoTextActive: { color: colors.mistWhite },
})
