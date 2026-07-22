import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Asset } from 'expo-asset'
// This SDK version moved the classic readAsStringAsync/downloadAsync/
// cacheDirectory API behind a /legacy subpath — `expo-file-system` itself
// now only exports the new File/Directory class API, which doesn't have
// these. (The rest of the app imports the bare 'expo-file-system' and hits
// the same now-untyped surface; left alone here since fixing that broadly
// is out of scope for this screen.)
import * as FileSystem from 'expo-file-system/legacy'
import { LinearGradient } from 'expo-linear-gradient'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { images } from '@/constants/images'
import { useNavGuard } from '@/hooks/useNavGuard'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

const REPORT_BUCKET = 'consultation-reports'

interface Prescription {
  medicine: string
  dosage: string
  duration: string
  instructions: string
}

interface SummaryData {
  id: string
  chief_complaint: string
  diagnosis: string
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean
  referral_specialty: string | null
  report_pdf_path: string | null
}

// Deliberately excludes phone/email/address — doctors must never see patient
// contact details here, only what's appropriate for a telemedicine profile.
interface PatientProfileInfo {
  fullName: string
  gender: string | null
  age: number | null
  photoUrl: string | null
}

function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const birth = new Date(dateOfBirth)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--
  return age
}

const TYPE_LABELS: Record<string, string> = {
  chat: 'Chat Consultation',
  phone: 'Phone Consultation',
  video: 'Video Consultation',
}

// Same started_at ?? scheduled_at ?? created_at priority used by the
// doctor/patient list screens and the web equivalent of this page, so this
// detail view always agrees with the list it was opened from.
function formatConsultMeta(type: string | null, iso: string | null): string {
  const label = TYPE_LABELS[type ?? 'chat'] ?? 'Consultation'
  if (!iso) return label
  const dt = new Date(iso)
  const date = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${label} · ${date}, ${time}`
}

export default function DoctorConsultationSummaryScreen() {
  const router = useRouter()
  const guardNav = useNavGuard()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { consultationId, patientName } = useLocalSearchParams<{
    consultationId: string
    patientName?: string
  }>()

  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Follow-up reminder state
  const [reminderDate, setReminderDate] = useState<Date | null>(null)
  const [reminderTime, setReminderTime] = useState<{ hour: number; minute: number }>({ hour: 9, minute: 0 })
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [reminderMsg, setReminderMsg] = useState('')
  const [schedulingReminder, setSchedulingReminder] = useState(false)
  const [reminderScheduled, setReminderScheduled] = useState(false)
  const [patientIdForReminder, setPatientIdForReminder] = useState<string | null>(null)
  const [doctorProfileId, setDoctorProfileId] = useState<string | null>(null)
  const [patientProfile, setPatientProfile] = useState<PatientProfileInfo | null>(null)

  // Consultation type + display timestamp — this screen previously fetched
  // neither, so a doctor viewing a summary had no way to tell what kind of
  // consultation it was or when it happened without going back to the list.
  // Also carries duration/earnings, which this screen never showed at all
  // (web's doctor summary page doesn't either — patient's does), and the
  // doctor's own display name/specialty for the PDF report header.
  const [consultMeta, setConsultMeta] = useState<{
    type: string | null
    displayAt: string | null
    durationMinutes: number | null
    doctorAmount: number | null
  } | null>(null)
  const [doctorReportInfo, setDoctorReportInfo] = useState<{ name: string; specialty: string }>({ name: 'Doctor', specialty: '' })
  const [patientNameForReport, setPatientNameForReport] = useState('Patient')
  const [generatingReport, setGeneratingReport] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState(false)

  // edit state
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [referralNeeded, setReferralNeeded] = useState(false)
  const [referralSpecialty, setReferralSpecialty] = useState('')
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [prescriptionEnabled, setPrescriptionEnabled] = useState(false)

  useEffect(() => {
    if (!consultationId) { setLoading(false); return }
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        // Get patient ID and doctor profile ID for follow-up reminders, plus
        // the patient's identity info (photo/age/gender) for the profile
        // section below — phone is intentionally NOT selected here, this
        // screen must never display patient contact details to the doctor.
        const { data: consultRow } = await getAuthClient(token)
          .from('consultations')
          .select('patient_id, type, started_at, scheduled_at, created_at, duration_minutes, doctor_amount, patient:users!patient_id(full_name, profile_photo_url, patient_profiles(gender, date_of_birth))')
          .eq('id', consultationId)
          .maybeSingle()
        if ((consultRow as any)?.patient_id) setPatientIdForReminder((consultRow as any).patient_id)
        if (consultRow) {
          const row = consultRow as any
          setConsultMeta({
            type: row.type ?? null,
            displayAt: row.started_at ?? row.scheduled_at ?? row.created_at ?? null,
            durationMinutes: row.duration_minutes ?? null,
            doctorAmount: row.doctor_amount ?? null,
          })
          const patientRow = Array.isArray(row.patient) ? row.patient[0] : row.patient
          if (patientRow) {
            const detail = Array.isArray(patientRow.patient_profiles) ? patientRow.patient_profiles[0] : patientRow.patient_profiles
            setPatientProfile({
              fullName: patientRow.full_name ?? patientName ?? 'Patient',
              gender: detail?.gender ?? null,
              age: calculateAge(detail?.date_of_birth),
              photoUrl: patientRow.profile_photo_url ?? null,
            })
          }
        }
        if (patientName) setPatientNameForReport(patientName)

        if (user) {
          const { data: ud } = await getAuthClient(token)
            .from('users').select('id, full_name').eq('clerk_id', user.id).single()
          if (ud) {
            const { data: dp } = await getAuthClient(token)
              .from('doctor_profiles').select('id, specialty').eq('user_id', (ud as any).id).single()
            if (dp) setDoctorProfileId((dp as any).id)
            const rawDoctorName = ((ud as any).full_name ?? user.fullName ?? '').replace(/^Dr\.?\s*/i, '').trim()
            setDoctorReportInfo({
              name: rawDoctorName ? `Dr. ${rawDoctorName}` : 'Doctor',
              specialty: (dp as any)?.specialty ?? '',
            })
          }
        }

        const { data } = await getAuthClient(token)
          .from('consultation_summaries')
          .select('id, chief_complaint, diagnosis, prescription, followup_recommendation, referral_needed, referral_specialty, report_pdf_path')
          .eq('consultation_id', consultationId)
          .maybeSingle()
        if (data) {
          setSummary(data as SummaryData)
          setChiefComplaint((data as any).chief_complaint ?? '')
          setDiagnosis((data as any).diagnosis ?? '')
          setFollowUp((data as any).followup_recommendation ?? '')
          setReferralNeeded((data as any).referral_needed ?? false)
          setReferralSpecialty((data as any).referral_specialty ?? '')
          if ((data as any).prescription) {
            try {
              const rxList = JSON.parse((data as any).prescription)
              if (Array.isArray(rxList) && rxList.length > 0) {
                setPrescriptions(rxList)
                setPrescriptionEnabled(true)
              }
            } catch {}
          }
        } else {
          setNotFound(true)
          setEditing(true)
        }
      } catch {
        Alert.alert('Error', 'Could not load consultation summary.')
      } finally {
        setLoading(false)
      }
    })()
  }, [consultationId])

  const handleSave = async () => {
    if (!chiefComplaint.trim() || !diagnosis.trim()) {
      Alert.alert('Missing Info', 'Chief complaint and diagnosis are required.')
      return
    }
    if (!consultationId) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const payload = {
        chief_complaint: chiefComplaint.trim(),
        diagnosis: diagnosis.trim(),
        prescription: prescriptionEnabled && prescriptions.length > 0
          ? JSON.stringify(prescriptions.filter(rx => rx.medicine.trim()))
          : null,
        followup_recommendation: followUp.trim() || null,
        referral_needed: referralNeeded,
        referral_specialty: referralNeeded && referralSpecialty.trim() ? referralSpecialty.trim() : null,
      }
      let summaryId = summary?.id
      if (summaryId) {
        const { error } = await client.from('consultation_summaries').update(payload).eq('id', summaryId)
        if (error) throw error
      } else {
        const { data: inserted, error } = await client
          .from('consultation_summaries')
          .insert({ consultation_id: consultationId, ...payload })
          .select('id')
          .single()
        if (error) throw error
        summaryId = (inserted as any)?.id
      }
      setSummary(prev => ({
        ...(prev ?? ({} as SummaryData)),
        id: summaryId as string,
        ...payload,
      }))
      setNotFound(false)
      setEditing(false)
      Alert.alert('Saved', 'Consultation summary saved successfully.')

      // Best-effort — the summary itself already saved even if this fails.
      if (summaryId) {
        setGeneratingReport(true)
        try {
          const path = await generateReport(client, consultationId, payload)
          if (path) setSummary(prev => prev ? { ...prev, report_pdf_path: path } : prev)
        } catch {
          // Report generation is best-effort — nothing to surface to the doctor.
        } finally {
          setGeneratingReport(false)
        }
      }
    } catch {
      Alert.alert('Error', 'Could not save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Generates a doctor-branded PDF client-side (same approach as the patient
  // app's consultation-summary screen) and uploads it to the same
  // `consultation-reports/{consultationId}/report.pdf` path the web app's
  // generateAndUploadReport() and the patient app both use, so a report
  // generated from any of the three surfaces is downloadable on the others.
  const generateReport = async (
    client: ReturnType<typeof getAuthClient>,
    consultId: string,
    payload: {
      chief_complaint: string
      diagnosis: string
      prescription: string | null
      followup_recommendation: string | null
      referral_needed: boolean
      referral_specialty: string | null
    },
  ): Promise<string | null> => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    let logoImgTag = ''
    try {
      const asset = Asset.fromModule(images.darkLogo)
      await asset.downloadAsync()
      if (asset.localUri) {
        const base64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 })
        logoImgTag = `<img src="data:image/jpeg;base64,${base64}" style="height:36px;margin-bottom:8px" />`
      }
    } catch {
      // Logo is a nice-to-have — proceed without it if it can't be loaded.
    }

    const prescriptionHtml = (() => {
      if (!payload.prescription) return '<p style="color:#6B7280">No prescription issued.</p>'
      try {
        const rxList = JSON.parse(payload.prescription) as Prescription[]
        return rxList.map(rx => `
          <div style="margin-bottom:10px;padding:10px;background:#F9FAFB;border-radius:8px">
            <strong>${esc(rx.medicine)}</strong>
            ${rx.dosage ? `<br/><span style="color:#6B7280">${esc(rx.dosage)}${rx.duration ? ' · ' + esc(rx.duration) : ''}</span>` : ''}
            ${rx.instructions ? `<br/><span style="color:#6B7280">${esc(rx.instructions)}</span>` : ''}
          </div>`).join('')
      } catch {
        return `<p>${esc(payload.prescription)}</p>`
      }
    })()

    const dateStr = consultMeta?.displayAt
      ? new Date(consultMeta.displayAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const typeLabel = TYPE_LABELS[consultMeta?.type ?? 'chat'] ?? 'Consultation'

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; margin: 40px; color: #111827; }
    h1   { font-size: 22px; color: #0A2463; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #6B7280; margin-bottom: 24px; }
    .meta { display: flex; gap: 32px; background: #F3F4F6; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; }
    .meta-item { font-size: 12px; }
    .meta-label { color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-value { font-weight: 600; margin-top: 2px; }
    .section { margin-bottom: 20px; }
    .section-label { font-size: 10px; font-weight: 700; color: #1A4598; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .section-body  { font-size: 14px; line-height: 1.6; }
    .referral { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 10px 14px; color: #1D4ED8; font-size: 13px; font-weight: 600; margin-top: 16px; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E5E7EB; font-size: 11px; color: #9CA3AF; text-align: center; }
  </style>
</head>
<body>
  ${logoImgTag}
  <h1>DAWA — Consultation Summary</h1>
  <p class="sub">This document is a confidential medical record generated by the Dawa Health Platform.</p>

  <div class="meta">
    <div class="meta-item"><div class="meta-label">Patient</div><div class="meta-value">${esc(patientNameForReport)}</div></div>
    <div class="meta-item"><div class="meta-label">Doctor</div><div class="meta-value">${esc(doctorReportInfo.name)}${doctorReportInfo.specialty ? ` · ${esc(doctorReportInfo.specialty)}` : ''}</div></div>
    <div class="meta-item"><div class="meta-label">Type</div><div class="meta-value">${esc(typeLabel)}</div></div>
    <div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${esc(dateStr)}</div></div>
  </div>

  <div class="section">
    <div class="section-label">Chief Complaint</div>
    <div class="section-body">${esc(payload.chief_complaint)}</div>
  </div>
  <div class="section">
    <div class="section-label">Diagnosis</div>
    <div class="section-body">${esc(payload.diagnosis)}</div>
  </div>
  <div class="section">
    <div class="section-label">Prescription</div>
    <div class="section-body">${prescriptionHtml}</div>
  </div>
  <div class="section">
    <div class="section-label">Follow-up Recommendation</div>
    <div class="section-body">${esc(payload.followup_recommendation ?? 'None')}</div>
  </div>
  ${payload.referral_needed ? `<div class="referral">📋 Referral recommended${payload.referral_specialty ? ` (${esc(payload.referral_specialty)})` : ''}.</div>` : ''}

  <div class="footer">This summary was generated during a Dawa teleconsultation and is not a substitute for in-person emergency care. If the patient is experiencing a medical emergency, direct them to local emergency services immediately.<br/>Powered by Dawa Health Platform · ${esc(dateStr)}</div>
</body>
</html>`

    const { uri } = await Print.printToFileAsync({ html, base64: false })
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const path = `${consultId}/report.pdf`
    const { error: uploadError } = await client.storage
      .from(REPORT_BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) return null
    await client.from('consultation_summaries').update({ report_pdf_path: path }).eq('consultation_id', consultId)
    return path
  }

  const handleDownloadReport = async () => {
    if (!summary?.report_pdf_path || !consultationId) return
    setDownloadingReport(true)
    try {
      const token = await getToken()
      if (!token) return
      const { data, error } = await getAuthClient(token).storage
        .from(REPORT_BUCKET)
        .createSignedUrl(summary.report_pdf_path, 3600)
      if (error || !data?.signedUrl) throw error ?? new Error('No signed URL')
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        const localUri = `${FileSystem.cacheDirectory}consultation-report-${consultationId}.pdf`
        const { uri } = await FileSystem.downloadAsync(data.signedUrl, localUri)
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or Share Consultation Report', UTI: 'com.adobe.pdf' })
      } else {
        await Linking.openURL(data.signedUrl)
      }
    } catch {
      Alert.alert('Error', 'Could not download the report. Please try again.')
    } finally {
      setDownloadingReport(false)
    }
  }

  const updateRx = (i: number, field: keyof Prescription, val: string) => {
    setPrescriptions(prev => { const next = [...prev]; next[i] = { ...next[i], [field]: val }; return next })
  }

  const scheduleReminder = async () => {
    if (!reminderDate || !patientIdForReminder || !doctorProfileId || !consultationId) return
    setSchedulingReminder(true)
    try {
      const token = await getToken()
      if (!token) return
      const remindAt = new Date(
        reminderDate.getFullYear(),
        reminderDate.getMonth(),
        reminderDate.getDate(),
        reminderTime.hour,
        reminderTime.minute,
        0,
      ).toISOString()
      await getAuthClient(token).from('followup_reminders').insert({
        consultation_id: consultationId,
        patient_id: patientIdForReminder,
        doctor_id: doctorProfileId,
        remind_at: remindAt,
        message: reminderMsg.trim() || null,
      })
      setReminderScheduled(true)
      setReminderDate(null)
      setReminderTime({ hour: 9, minute: 0 })
      setReminderMsg('')
      Alert.alert('Reminder Scheduled', 'The patient will receive a push notification at the scheduled time.')
    } catch {
      Alert.alert('Error', 'Could not schedule reminder. Please try again.')
    } finally {
      setSchedulingReminder(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.headerTitle}>Consultation Summary</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.tealGreen} />
        </View>
      </SafeAreaView>
    )
  }

  if (!summary && !notFound) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
          </Pressable>
          <Text style={styles.headerTitle}>Consultation Summary</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Ionicons name="document-text-outline" size={52} color={colors.steelGrey} />
          <Text style={{ fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack }}>No Summary Found</Text>
          <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 32 }}>
            A summary hasn't been recorded for this consultation.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  const parsedRx: Prescription[] = (() => {
    if (!summary?.prescription) return []
    try { return JSON.parse(summary.prescription) } catch { return [] }
  })()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>{notFound ? 'Add Consultation Notes' : 'Consultation Summary'}</Text>
        {editing ? (
          notFound ? (
            <View style={{ width: 36 }} />
          ) : (
            <Pressable
              onPress={() => setEditing(false)}
              hitSlop={10}
              style={styles.cancelBtn}
            >
              <Text style={styles.editBtnText} numberOfLines={1}>Cancel</Text>
            </Pressable>
          )
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {generatingReport ? (
              <ActivityIndicator size="small" color={colors.careBlue} />
            ) : summary?.report_pdf_path ? (
              <Pressable
                onPress={handleDownloadReport}
                disabled={downloadingReport}
                hitSlop={10}
                style={[styles.editBtn, downloadingReport && { opacity: 0.5 }]}
                accessibilityLabel="Download consultation report"
              >
                {downloadingReport ? (
                  <ActivityIndicator size="small" color={colors.tealGreen} />
                ) : (
                  <Ionicons name="download-outline" size={20} color={colors.tealGreen} />
                )}
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setEditing(true)}
              hitSlop={10}
              style={styles.editBtn}
            >
              <Ionicons name="create-outline" size={20} color={colors.careBlue} />
            </Pressable>
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Patient card */}
        <LinearGradient colors={gradients.hero} style={styles.patientCard}>
          <View style={styles.patientAvatarCircle}>
            <Ionicons name="person" size={28} color="rgba(255,255,255,0.7)" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.patientCardName}>{patientName ?? 'Patient'}</Text>
            <Text style={styles.patientCardSub}>
              {consultMeta ? formatConsultMeta(consultMeta.type, consultMeta.displayAt) : 'Completed consultation'}
            </Text>
          </View>
          {summary?.referral_needed && (
            <View style={styles.referralBadge}>
              <Text style={styles.referralBadgeText}>Referral</Text>
            </View>
          )}
        </LinearGradient>

        {/* Patient profile section — this screen previously gave no access to
            who the patient actually is beyond their name in the header
            above. */}
        {patientProfile && (
          <View style={styles.patientProfileCard}>
            <View style={styles.patientProfileTop}>
              {patientProfile.photoUrl ? (
                <Image source={{ uri: patientProfile.photoUrl }} style={styles.patientProfileAvatar} />
              ) : (
                <View style={styles.patientProfileAvatarFallback}>
                  <Ionicons name="person" size={22} color={colors.careBlue} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.patientProfileName}>{patientProfile.fullName}</Text>
                <Text style={styles.patientProfileMeta}>
                  {[patientProfile.gender, patientProfile.age != null ? `${patientProfile.age} yrs` : null]
                    .filter(Boolean).join(' · ') || 'No demographic info on file'}
                </Text>
              </View>
            </View>
            {!!patientIdForReminder && (
              <Pressable
                style={styles.patientProfileHistoryBtn}
                onPress={guardNav(() => router.push({
                  pathname: '/(doctor)/patient-history',
                  params: { patientId: patientIdForReminder, patientName: patientProfile.fullName },
                }))}
                accessibilityLabel="View patient's full profile and history"
                accessibilityRole="button"
              >
                <Ionicons name="person-circle-outline" size={16} color={colors.careBlue} />
                <Text style={styles.patientProfileHistoryBtnText}>View Full Profile & History</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.careBlue} />
              </Pressable>
            )}
          </View>
        )}

        {/* Duration / earnings — this screen never showed either before. */}
        {!editing && consultMeta && (consultMeta.durationMinutes != null || consultMeta.doctorAmount != null) && (
          <View style={styles.metaRow}>
            <View style={styles.metaStat}>
              <Text style={styles.metaStatLabel}>DURATION</Text>
              <Text style={styles.metaStatValue}>
                {consultMeta.durationMinutes != null ? `${consultMeta.durationMinutes} min` : '—'}
              </Text>
            </View>
            <View style={styles.metaStat}>
              <Text style={styles.metaStatLabel}>YOUR EARNINGS</Text>
              <Text style={styles.metaStatValue}>
                {consultMeta.doctorAmount != null ? `ETB ${consultMeta.doctorAmount}` : '—'}
              </Text>
            </View>
          </View>
        )}

        {editing ? (
          /* ── Edit mode ── */
          <>
            <Field label="Chief Complaint" required>
              <TextInput
                style={styles.input}
                value={chiefComplaint}
                onChangeText={setChiefComplaint}
                placeholder="Patient's primary complaint"
                placeholderTextColor="#9CA3AF"
                multiline
              />
            </Field>
            <Field label="Diagnosis" required>
              <TextInput
                style={styles.input}
                value={diagnosis}
                onChangeText={setDiagnosis}
                placeholder="Diagnosis / clinical findings"
                placeholderTextColor="#9CA3AF"
                multiline
              />
            </Field>
            <Field label="Follow-up Recommendation">
              <TextInput
                style={styles.input}
                value={followUp}
                onChangeText={setFollowUp}
                placeholder="Optional follow-up instructions"
                placeholderTextColor="#9CA3AF"
                multiline
              />
            </Field>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Referral Needed</Text>
              <Switch
                value={referralNeeded}
                onValueChange={setReferralNeeded}
                trackColor={{ true: colors.careBlue, false: colors.steelGrey }}
                thumbColor={colors.mistWhite}
              />
            </View>
            {referralNeeded && (
              <Field label="Referral Specialty">
                <TextInput
                  style={styles.input}
                  value={referralSpecialty}
                  onChangeText={setReferralSpecialty}
                  placeholder="e.g. Cardiology"
                  placeholderTextColor="#9CA3AF"
                />
              </Field>
            )}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Add Prescription</Text>
              <Switch
                value={prescriptionEnabled}
                onValueChange={(v) => {
                  setPrescriptionEnabled(v)
                  if (v && prescriptions.length === 0) {
                    setPrescriptions([{ medicine: '', dosage: '', duration: '', instructions: '' }])
                  }
                }}
                trackColor={{ true: colors.tealGreen, false: colors.steelGrey }}
                thumbColor={colors.mistWhite}
              />
            </View>
            {prescriptionEnabled && prescriptions.map((rx, i) => (
              <View key={i} style={styles.rxEditCard}>
                <Text style={styles.rxEditTitle}>Medicine {i + 1}</Text>
                <TextInput style={styles.rxInput} placeholder="Medicine name" placeholderTextColor="#9CA3AF" value={rx.medicine} onChangeText={v => updateRx(i, 'medicine', v)} />
                <TextInput style={styles.rxInput} placeholder="Dosage (e.g. 500mg twice daily)" placeholderTextColor="#9CA3AF" value={rx.dosage} onChangeText={v => updateRx(i, 'dosage', v)} />
                <TextInput style={styles.rxInput} placeholder="Duration (e.g. 7 days)" placeholderTextColor="#9CA3AF" value={rx.duration} onChangeText={v => updateRx(i, 'duration', v)} />
                <TextInput style={styles.rxInput} placeholder="Instructions" placeholderTextColor="#9CA3AF" value={rx.instructions} onChangeText={v => updateRx(i, 'instructions', v)} />
                {prescriptions.length > 1 && (
                  <Pressable onPress={() => setPrescriptions(p => p.filter((_, idx) => idx !== i))} style={styles.rxRemoveBtn}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.error }}>Remove</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {prescriptionEnabled && (
              <Pressable
                onPress={() => setPrescriptions(p => [...p, { medicine: '', dosage: '', duration: '', instructions: '' }])}
                style={styles.addRxBtn}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.tealGreen} />
                <Text style={styles.addRxText}>Add Another Medicine</Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [styles.saveWrap, pressed && { opacity: 0.88 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
              </LinearGradient>
            </Pressable>
          </>
        ) : (
          /* ── View mode ── */
          <>
            <SummarySection label="Chief Complaint" value={summary?.chief_complaint ?? 'Not recorded'} />
            <SummarySection label="Diagnosis" value={summary?.diagnosis ?? 'Not recorded'} />
            <SummarySection label="Follow-up Recommendation" value={summary?.followup_recommendation ?? 'None'} />
            {summary?.referral_needed && (
              <View style={styles.referralRow}>
                <Ionicons name="arrow-forward-circle" size={16} color={colors.careBlue} />
                <Text style={styles.referralRowText}>
                  Specialist referral recommended{summary.referral_specialty ? ` — ${summary.referral_specialty}` : ''}
                </Text>
              </View>
            )}
            {parsedRx.length > 0 && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>PRESCRIPTION</Text>
                {parsedRx.map((rx, i) => (
                  <View key={i} style={[styles.rxViewItem, i < parsedRx.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.cloudGrey, paddingBottom: 10, marginBottom: 10 }]}>
                    <Text style={styles.rxMedicine}>{rx.medicine}</Text>
                    {rx.dosage ? <Text style={styles.rxDetail}>{rx.dosage}{rx.duration ? ' · ' + rx.duration : ''}</Text> : null}
                    {rx.instructions ? <Text style={styles.rxDetail}>{rx.instructions}</Text> : null}
                  </View>
                ))}
              </View>
            )}
            {parsedRx.length === 0 && (
              <SummarySection label="Prescription" value="No prescription issued" />
            )}
          </>
        )}

        {/* Follow-up Reminder section (view mode only) */}
        {!editing && (
          <View style={reminderStyles.card}>
            <Text style={reminderStyles.title}>Schedule Follow-up Reminder</Text>
            <Text style={reminderStyles.sub}>Patient will receive a push notification at the scheduled time.</Text>
            {reminderScheduled ? (
              <View style={reminderStyles.successRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.tealGreen} />
                <Text style={reminderStyles.successText}>Reminder scheduled successfully!</Text>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => { setCalendarMonth(reminderDate ?? new Date()); setShowDatePicker(true) }}
                  style={reminderStyles.pickerField}
                  accessibilityLabel="Reminder date"
                  accessibilityRole="button"
                >
                  <Ionicons name="calendar-outline" size={18} color={colors.careBlue} />
                  <Text style={[reminderStyles.pickerFieldText, !reminderDate && reminderStyles.pickerPlaceholder]}>
                    {reminderDate ? formatDateDisplay(reminderDate) : 'Select date'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowTimePicker(true)}
                  style={reminderStyles.pickerField}
                  accessibilityLabel="Reminder time"
                  accessibilityRole="button"
                >
                  <Ionicons name="time-outline" size={18} color={colors.careBlue} />
                  <Text style={reminderStyles.pickerFieldText}>{formatTimeDisplay(reminderTime)}</Text>
                </Pressable>
                <TextInput
                  style={[reminderStyles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  placeholder="Message (optional)"
                  placeholderTextColor="#9CA3AF"
                  value={reminderMsg}
                  onChangeText={setReminderMsg}
                  multiline
                  maxLength={200}
                  accessibilityLabel="Reminder message"
                />
                <Pressable
                  onPress={scheduleReminder}
                  disabled={!reminderDate || schedulingReminder}
                  style={({ pressed }) => [reminderStyles.btn, pressed && { opacity: 0.8 }, (!reminderDate || schedulingReminder) && { opacity: 0.4 }]}
                  accessibilityLabel="Schedule follow-up reminder"
                  accessibilityRole="button"
                >
                  {schedulingReminder ? (
                    <ActivityIndicator size="small" color={colors.mistWhite} />
                  ) : (
                    <>
                      <Ionicons name="calendar-outline" size={16} color={colors.mistWhite} />
                      <Text style={reminderStyles.btnText}>Schedule Reminder</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Date picker modal */}
      <Modal visible={showDatePicker} transparent animationType="fade" onRequestClose={() => setShowDatePicker(false)}>
        <Pressable style={reminderStyles.modalBackdrop} onPress={() => setShowDatePicker(false)}>
          <Pressable style={reminderStyles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={reminderStyles.calHeader}>
              <Pressable onPress={() => setCalendarMonth(m => addMonths(m, -1))} hitSlop={8}>
                <Ionicons name="chevron-back" size={22} color={colors.inkBlack} />
              </Pressable>
              <Text style={reminderStyles.calHeaderText}>{monthLabel(calendarMonth)}</Text>
              <Pressable onPress={() => setCalendarMonth(m => addMonths(m, 1))} hitSlop={8}>
                <Ionicons name="chevron-forward" size={22} color={colors.inkBlack} />
              </Pressable>
            </View>
            <View style={reminderStyles.calWeekRow}>
              {WEEKDAY_SHORT.map((d, i) => (
                <Text key={i} style={reminderStyles.calWeekDay}>{d}</Text>
              ))}
            </View>
            <View style={reminderStyles.calGrid}>
              {buildCalendarDays(calendarMonth).map((day, idx) => {
                if (!day) return <View key={idx} style={reminderStyles.calDay} />
                const disabled = isPastDay(day)
                const selected = isSameDay(day, reminderDate)
                return (
                  <Pressable
                    key={idx}
                    disabled={disabled}
                    onPress={() => { setReminderDate(day); setShowDatePicker(false) }}
                    style={[reminderStyles.calDay, selected && reminderStyles.calDaySelected]}
                  >
                    <Text style={[
                      reminderStyles.calDayText,
                      selected && reminderStyles.calDayTextSelected,
                      disabled && reminderStyles.calDayTextDisabled,
                    ]}>{day.getDate()}</Text>
                  </Pressable>
                )
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Time picker modal */}
      <Modal visible={showTimePicker} transparent animationType="fade" onRequestClose={() => setShowTimePicker(false)}>
        <Pressable style={reminderStyles.modalBackdrop} onPress={() => setShowTimePicker(false)}>
          <Pressable style={reminderStyles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={reminderStyles.calHeaderText}>Select Time</Text>
            <View style={reminderStyles.timeColumns}>
              <ScrollView style={reminderStyles.timeColumn} showsVerticalScrollIndicator={false}>
                {HOURS.map(h => (
                  <Pressable
                    key={h}
                    onPress={() => setReminderTime(t => ({ ...t, hour: h }))}
                    style={[reminderStyles.timeOption, reminderTime.hour === h && reminderStyles.timeOptionSelected]}
                  >
                    <Text style={[reminderStyles.timeOptionText, reminderTime.hour === h && reminderStyles.timeOptionTextSelected]}>
                      {String(h).padStart(2, '0')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={reminderStyles.timeColon}>:</Text>
              <ScrollView style={reminderStyles.timeColumn} showsVerticalScrollIndicator={false}>
                {MINUTES.map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setReminderTime(t => ({ ...t, minute: m }))}
                    style={[reminderStyles.timeOption, reminderTime.minute === m && reminderStyles.timeOptionSelected]}
                  >
                    <Text style={[reminderStyles.timeOptionText, reminderTime.minute === m && reminderStyles.timeOptionTextSelected]}>
                      {String(m).padStart(2, '0')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <Pressable onPress={() => setShowTimePicker(false)} style={reminderStyles.timeDoneBtn}>
              <Text style={reminderStyles.timeDoneBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

function formatDateDisplay(d: Date): string {
  return `${WEEKDAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

function formatTimeDisplay(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

function isSameDay(a: Date, b: Date | null): boolean {
  if (!b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isPastDay(d: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cmp = new Date(d)
  cmp.setHours(0, 0, 0, 0)
  return cmp.getTime() < today.getTime()
}

function buildCalendarDays(monthDate: Date): (Date | null)[] {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}{required ? ' *' : ''}</Text>
      {children}
    </View>
  )
}

function SummarySection({ label, value }: { label: string; value: string }) {
  return (
    <View style={viewStyles.card}>
      <Text style={viewStyles.label}>{label.toUpperCase()}</Text>
      <Text style={viewStyles.value}>{value}</Text>
    </View>
  )
}

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.careBlue, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
})

const viewStyles = StyleSheet.create({
  card: { backgroundColor: colors.mistWhite, borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey, padding: 16, marginBottom: 14 },
  label: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.careBlue, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 22 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.mistWhite,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  editBtn: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  cancelBtn: {
    height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF5F5', paddingHorizontal: 14, alignSelf: 'center', flexShrink: 0,
  },
  editBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.error },

  patientCard: {
    borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 20, ...shadow(colors.careBlue, 0, 3, 10, 0.2, 4),
  },
  patientAvatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  patientCardName: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  patientCardSub: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  referralBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  referralBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.mistWhite },

  patientProfileCard: {
    backgroundColor: colors.mistWhite, borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 16, marginBottom: 20,
  },
  patientProfileTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  patientProfileAvatar: { width: 44, height: 44, borderRadius: 22 },
  patientProfileAvatarFallback: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  patientProfileName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  patientProfileMeta: { fontFamily: fonts.regular, fontSize: 12.5, color: '#6B7280', marginTop: 2 },
  patientProfileHistoryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  patientProfileHistoryBtnText: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.careBlue, flex: 1 },

  metaRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  metaStat: {
    flex: 1, backgroundColor: colors.mistWhite, borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  metaStatLabel: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.careBlue, letterSpacing: 0.5, marginBottom: 4 },
  metaStatValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },

  referralRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12 },
  referralRowText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.careBlue },

  sectionCard: { backgroundColor: colors.mistWhite, borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey, padding: 16, marginBottom: 14 },
  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.careBlue, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  rxViewItem: {},
  rxMedicine: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  rxDetail: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },

  input: {
    backgroundColor: colors.mistWhite, borderRadius: 10, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack,
    minHeight: 48, textAlignVertical: 'top',
  },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.mistWhite, borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: colors.steelGrey,
  },
  switchLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },

  rxEditCard: { backgroundColor: colors.mistWhite, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.steelGrey, gap: 8 },
  rxEditTitle: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack, marginBottom: 4 },
  rxInput: {
    backgroundColor: colors.cloudGrey, borderRadius: 8, padding: 10,
    fontFamily: fonts.regular, fontSize: 13, color: colors.inkBlack,
  },
  rxRemoveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },

  addRxBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20, paddingVertical: 10 },
  addRxText: { fontFamily: fonts.medium, fontSize: 14, color: colors.tealGreen },

  saveWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  saveBtn: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  saveBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})

const reminderStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.mistWhite, borderRadius: 14, borderWidth: 1,
    borderColor: colors.steelGrey, padding: 16, marginBottom: 14,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, marginBottom: 4 },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 12 },
  input: {
    backgroundColor: colors.cloudGrey, borderRadius: 10, borderWidth: 1, borderColor: colors.steelGrey,
    padding: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, marginBottom: 10,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: 12, backgroundColor: colors.tealGreen,
  },
  btnText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  successText: { fontFamily: fonts.medium, fontSize: 14, color: colors.tealGreen },

  pickerField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.cloudGrey, borderRadius: 10, borderWidth: 1, borderColor: colors.steelGrey,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 10,
  },
  pickerFieldText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack },
  pickerPlaceholder: { color: '#9CA3AF' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 340, backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16,
    ...shadow(colors.inkBlack, 0, 4, 16, 0.25, 8),
  },

  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calHeaderText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack, textAlign: 'center' },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekDay: { flex: 1, textAlign: 'center', fontFamily: fonts.medium, fontSize: 11, color: '#6B7280' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDay: {
    width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center',
  },
  calDaySelected: { backgroundColor: colors.tealGreen, borderRadius: 999 },
  calDayText: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkBlack },
  calDayTextSelected: { fontFamily: fonts.semiBold, color: colors.mistWhite },
  calDayTextDisabled: { color: '#D1D5DB' },

  timeColumns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 180, marginTop: 8 },
  timeColumn: { width: 70 },
  timeColon: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginHorizontal: 8 },
  timeOption: { paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  timeOptionSelected: { backgroundColor: colors.tealGreen },
  timeOptionText: { fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  timeOptionTextSelected: { fontFamily: fonts.semiBold, color: colors.mistWhite },
  timeDoneBtn: {
    marginTop: 12, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealGreen,
  },
  timeDoneBtnText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.mistWhite },
})
