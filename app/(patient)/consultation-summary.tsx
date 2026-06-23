import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { getAuthClient } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'

interface SummaryData {
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean | null
}

const TYPE_ICONS: Record<string, string> = {
  chat: 'chatbubble-ellipses',
  phone: 'call',
  video: 'videocam',
}

export default function ConsultationSummaryScreen() {
  const { t } = useTranslation()
  const { doctorId, doctorName, consultationType, consultationId } = useLocalSearchParams<{
    doctorId?: string
    doctorName?: string
    consultationType?: string
    consultationId?: string
  }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()

  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  useEffect(() => {
    if (!consultationId) { setSummaryLoading(false); return }
    getToken().then(token => {
      if (!token) { setSummaryLoading(false); return }
      getAuthClient(token)
        .from('consultation_summaries')
        .select('chief_complaint,diagnosis,prescription,followup_recommendation,referral_needed')
        .eq('consultation_id', consultationId)
        .maybeSingle()
        .then(({ data }) => { setSummary(data); setSummaryLoading(false) })
    })
  }, [consultationId])

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const TYPE_LABELS: Record<string, string> = {
    chat: t('chatConsultation'),
    phone: t('phoneCall'),
    video: t('videoCall'),
  }
  const typeLabel = TYPE_LABELS[consultationType ?? 'chat'] ?? t('consultationsTab')
  const typeIcon = TYPE_ICONS[consultationType ?? 'chat'] ?? 'medical'

  const handleDone = async () => {
    if (rating === 0) {
      Alert.alert(t('rateYourExperience'), t('pleaseRateFirst'))
      return
    }
    if (submitting) return
    setSubmitting(true)

    try {
      const token = await getToken()
      if (token && consultationId && user?.id) {
        const client = getAuthClient(token)

        // Get current user's Supabase id
        const { data: userData } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', user.id)
          .single()

        if (userData?.id && doctorId) {
          await client.from('reviews').insert({
            consultation_id: consultationId,
            patient_id: userData.id,
            doctor_id: doctorId,
            rating,
            comment: comment.trim() || null,
          })
        }
      }
    } catch {
      // Review save is best-effort — still navigate on failure
    }

    setSubmitting(false)
    Alert.alert(t('thankYou'), t('ratingSubmitted'), [
      { text: t('done'), onPress: () => router.replace('/(patient)/(tabs)/appointments') },
    ])
  }

  const handleDownload = async () => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const prescriptionHtml = (() => {
      if (!summary?.prescription) return '<p style="color:#6B7280">No prescription issued.</p>'
      try {
        const rxList = JSON.parse(summary.prescription) as Array<{
          medicine: string; dosage: string; duration: string; instructions: string
        }>
        return rxList.map(rx => `
          <div style="margin-bottom:10px;padding:10px;background:#F9FAFB;border-radius:8px">
            <strong>${esc(rx.medicine)}</strong>
            ${rx.dosage ? `<br/><span style="color:#6B7280">${esc(rx.dosage)}${rx.duration ? ' · ' + esc(rx.duration) : ''}</span>` : ''}
            ${rx.instructions ? `<br/><span style="color:#6B7280">${esc(rx.instructions)}</span>` : ''}
          </div>`).join('')
      } catch {
        return `<p>${esc(summary.prescription)}</p>`
      }
    })()

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
  <h1>DAWA — Consultation Summary</h1>
  <p class="sub">This document is a confidential medical record generated by the Dawa Health Platform.</p>

  <div class="meta">
    <div class="meta-item"><div class="meta-label">Doctor</div><div class="meta-value">${esc(doctorName ?? '—')}</div></div>
    <div class="meta-item"><div class="meta-label">Type</div><div class="meta-value">${esc(typeLabel)}</div></div>
    <div class="meta-item"><div class="meta-label">Date</div><div class="meta-value">${esc(dateStr)}</div></div>
  </div>

  <div class="section">
    <div class="section-label">Chief Complaint</div>
    <div class="section-body">${esc(summary?.chief_complaint ?? 'Not recorded')}</div>
  </div>
  <div class="section">
    <div class="section-label">Diagnosis</div>
    <div class="section-body">${esc(summary?.diagnosis ?? 'Awaiting doctor notes')}</div>
  </div>
  <div class="section">
    <div class="section-label">Prescription</div>
    <div class="section-body">${prescriptionHtml}</div>
  </div>
  <div class="section">
    <div class="section-label">Follow-up Recommendation</div>
    <div class="section-body">${esc(summary?.followup_recommendation ?? 'None')}</div>
  </div>
  ${summary?.referral_needed ? '<div class="referral">📋 Doctor recommends a specialist referral.</div>' : ''}

  <div class="footer">Powered by Dawa Health Platform · ${esc(dateStr)}</div>
</body>
</html>`

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false })
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save or Share Consultation Summary',
          UTI: 'com.adobe.pdf',
        })
      } else {
        Alert.alert('PDF Saved', `Your consultation summary PDF has been saved to:\n${uri}`)
      }
    } catch {
      Alert.alert('Error', 'Could not generate PDF. Please try again.')
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Success header */}
        <LinearGradient
          colors={['#F0FDFB', '#EFF6FF']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={36} color={colors.mistWhite} />
          </View>
          <Text style={styles.heroTitle}>{t('consultationComplete')}</Text>
          <Text style={styles.heroSub}>
            {t('sessionEndedWith')} {doctorName ?? t('doctorLabel')} {t('sessionEndedSuffix')}
          </Text>
        </LinearGradient>

        {/* Session details */}
        <View style={styles.detailCard}>
          <Row icon={typeIcon} label={typeLabel} value="" accent />
          <Divider />
          <Row icon="person-outline" label={t('doctorLabel')} value={doctorName ?? '—'} />
          <Row icon="calendar-outline" label={t('dateLabel')} value={dateStr} />
        </View>

        {/* Clinical notes — real data from consultation_summaries */}
        {summaryLoading ? (
          <View style={styles.summaryLoading}>
            <ActivityIndicator color={colors.careBlue} />
            <Text style={styles.summaryLoadingText}>{t('loadingNotes')}</Text>
          </View>
        ) : (
          <>
            <SectionCard title={t('chiefComplaint')}>
              <Text style={styles.noteText}>
                {summary?.chief_complaint ?? t('clinicalNotesPlaceholder')}
              </Text>
            </SectionCard>

            <SectionCard title={t('diagnosis')}>
              <Text style={styles.noteText}>
                {summary?.diagnosis ?? t('awaitingDoctorNotes')}
              </Text>
            </SectionCard>

            {summary?.prescription ? (
              <SectionCard title={t('prescription')}>
                {(() => {
                  try {
                    const rxList = JSON.parse(summary.prescription) as Array<{
                      medicine: string; dosage: string; duration: string; instructions: string
                    }>
                    return rxList.map((rx, i) => (
                      <View key={i} style={styles.rxItem}>
                        <Text style={styles.rxMedicine}>{rx.medicine}</Text>
                        {rx.dosage ? <Text style={styles.rxDetail}>{rx.dosage} · {rx.duration}</Text> : null}
                        {rx.instructions ? <Text style={styles.rxInstructions}>{rx.instructions}</Text> : null}
                      </View>
                    ))
                  } catch {
                    return <Text style={styles.noteText}>{summary.prescription}</Text>
                  }
                })()}
              </SectionCard>
            ) : null}

            <SectionCard title={t('followUpRecommendation')}>
              <Text style={styles.noteText}>
                {summary?.followup_recommendation ?? t('followUpPlaceholder')}
              </Text>
            </SectionCard>

            {summary?.referral_needed ? (
              <View style={styles.referralBadge}>
                <Ionicons name="arrow-forward-circle" size={16} color={colors.careBlue} />
                <Text style={styles.referralText}>{t('referralRecommended')}</Text>
              </View>
            ) : null}
          </>
        )}

        {/* Download button */}
        <Pressable
          style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDownload}
        >
          <Ionicons name="download-outline" size={18} color={colors.careBlue} />
          <Text style={styles.downloadText}>{t('downloadAsPDF')}</Text>
        </Pressable>

        {/* Rating section */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>{t('rateYourDoctor')}</Text>
          <Text style={styles.ratingSub}>
            {t('howWasExperience')} {doctorName ?? t('doctorLabel')}?
          </Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(star => (
              <Pressable key={star} onPress={() => setRating(star)}>
                <Ionicons
                  name={star <= rating ? 'star' : 'star-outline'}
                  size={38}
                  color={star <= rating ? colors.warning : colors.steelGrey}
                />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.commentInput}
            placeholder={t('leaveComment')}
            placeholderTextColor="#9CA3AF"
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={300}
          />
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* Done button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.doneWrap, pressed && { opacity: 0.88 }]}
          onPress={handleDone}
          disabled={submitting}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.doneBtn}
          >
            <Text style={styles.doneBtnText}>
              {submitting ? t('submitting') : t('submitAndDone')}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function Row({ icon, label, value, accent }: {
  icon: string; label: string; value: string; accent?: boolean
}) {
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, accent && rowStyles.iconWrapAccent]}>
        <Ionicons name={icon as any} size={16} color={accent ? colors.tealGreen : '#6B7280'} />
      </View>
      <Text style={rowStyles.label}>{label}</Text>
      {value ? <Text style={rowStyles.value}>{value}</Text> : null}
    </View>
  )
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.cloudGrey, marginVertical: 4 }} />
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.title}>{title}</Text>
      {children}
    </View>
  )
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  iconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.cloudGrey, alignItems: 'center', justifyContent: 'center' },
  iconWrapAccent: { backgroundColor: '#F0FDFB' },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack },
  value: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', flexShrink: 1, textAlign: 'right', maxWidth: '50%' },
})

const cardStyles = StyleSheet.create({
  card: { marginHorizontal: 20, marginBottom: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey, padding: 16 },
  title: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.careBlue, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingBottom: 20 },

  hero: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, marginBottom: 20 },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.tealGreen,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    ...shadow(colors.tealGreen, 0, 6, 14, 0.35, 6),
  },
  heroTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, marginBottom: 6, textAlign: 'center' },
  heroSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center' },

  detailCard: {
    marginHorizontal: 20, marginBottom: 16,
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey, padding: 16,
  },

  noteText: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 22 },
  summaryLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 14, paddingVertical: 16 },
  summaryLoadingText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  rxItem: { marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  rxMedicine: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  rxDetail: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  rxInstructions: { fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 2 },
  referralBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 14, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12 },
  referralText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.careBlue },

  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 24,
    height: 46, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.careBlue,
    backgroundColor: '#EFF6FF',
  },
  downloadText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.careBlue },

  ratingSection: { marginHorizontal: 20, marginBottom: 8 },
  ratingTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 4 },
  ratingSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  commentInput: {
    borderRadius: 12, borderWidth: 1.5, borderColor: colors.steelGrey,
    padding: 14, fontFamily: fonts.regular, fontSize: 14,
    color: colors.inkBlack, minHeight: 80, textAlignVertical: 'top',
  },

  bottomPad: { height: 16 },

  footer: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
    backgroundColor: colors.mistWhite,
  },
  doneWrap: { borderRadius: 16, overflow: 'hidden' },
  doneBtn: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  doneBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})
