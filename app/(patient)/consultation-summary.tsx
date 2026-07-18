import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Asset } from 'expo-asset'
// This SDK version moved the classic readAsStringAsync/EncodingType API behind
// a /legacy subpath — the bare 'expo-file-system' export is now the new
// File/Directory class API only, which doesn't have these (see also
// app/(doctor)/consultation-summary.tsx, PdfViewerModal.tsx).
import * as FileSystem from 'expo-file-system/legacy'
import { LinearGradient } from 'expo-linear-gradient'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { CareHubAlert } from '@/components/ui/CareHubAlert'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { images } from '@/constants/images'
import { useUserProfileRealtime } from '@/hooks/useUserProfileRealtime'
import { formatDoctorName, normalizeNameCase } from '@/lib/nameFormat'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'
import { markNotificationsReadForConsultation } from '@/lib/notificationCenter'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from 'react-i18next'

interface SummaryData {
  chief_complaint: string | null
  diagnosis: string | null
  prescription: string | null
  followup_recommendation: string | null
  referral_needed: boolean | null
  referral_specialty: string | null
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
  const [commentError, setCommentError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const scrollRef = useRef<ScrollView>(null)

  // Doctor identity — always fetched fresh from the DB (never trusted off the
  // route params, which can be stale, missing, or truncated depending on
  // which screen navigated here) using the same doctor_profiles→users join
  // and live-sync hook as doctor-profile.tsx / chat-consultation.tsx, so this
  // screen always agrees with the doctor's current profile.
  const [doctorUserId, setDoctorUserId] = useState<string | null>(null)
  const [doctorInitialName, setDoctorInitialName] = useState<string | null>(null)
  const [doctorInitialPhotoUrl, setDoctorInitialPhotoUrl] = useState<string | null>(null)
  const [resolvedDoctorId, setResolvedDoctorId] = useState<string | null>(null)
  const { name: liveDoctorName, photoUrl: liveDoctorPhotoUrl } = useUserProfileRealtime(
    doctorUserId,
    doctorInitialName ?? doctorName ?? null,
    doctorInitialPhotoUrl
  )
  // Auto-clear: reaching this screen directly (Appointments tab, deep link)
  // rather than by tapping the summary_ready/summary_updated notification
  // still means it's been handled — mark it read so it doesn't sit stale in
  // the tray/badge/Notification Center.
  const dbUserId = useAuthStore((s) => s.userId)
  useEffect(() => {
    if (!consultationId || !dbUserId) return
    markNotificationsReadForConsultation(supabase, dbUserId, consultationId)
  }, [consultationId, dbUserId])

  const rawDoctorName = liveDoctorName ?? doctorInitialName ?? doctorName ?? null
  const displayDoctorName = rawDoctorName ? formatDoctorName(normalizeNameCase(rawDoctorName)) : t('doctorLabel')
  const displayDoctorPhotoUrl = liveDoctorPhotoUrl ?? doctorInitialPhotoUrl ?? null
  const finalDoctorId = doctorId || resolvedDoctorId || undefined

  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('doctor_id, doctor_profiles!doctor_id(users!inner(id, full_name, profile_photo_url))')
          .eq('id', consultationId)
          .maybeSingle()
        if (cancelled || !data) return
        const doctorProfile = (data as any).doctor_profiles
        setResolvedDoctorId((data as any).doctor_id ?? null)
        setDoctorUserId(doctorProfile?.users?.id ?? null)
        setDoctorInitialName(doctorProfile?.users?.full_name ?? null)
        setDoctorInitialPhotoUrl(doctorProfile?.users?.profile_photo_url ?? null)
      } catch {
        // best-effort — falls back to the route param name if this fails
      }
    })()
    return () => { cancelled = true }
  }, [consultationId])

  // Existing rating for this consultation — if found, show a read-only
  // "already rated" summary with Edit Rating/Edit Review instead of the
  // blank star form, and update that row on submit instead of inserting a
  // second one.
  const [existingReviewId, setExistingReviewId] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [editingRating, setEditingRating] = useState(false)

  // Real consultation date, fetched from the DB — previously this screen
  // rendered `new Date()` at render time, so a summary opened days later
  // showed today's date instead of when the consultation actually happened.
  const [consultationDate, setConsultationDate] = useState<Date | null>(null)

  useEffect(() => {
    if (!consultationId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const { data } = await getAuthClient(token)
          .from('consultations')
          .select('started_at, scheduled_at, created_at')
          .eq('id', consultationId)
          .maybeSingle()
        if (cancelled || !data) return
        // Same started_at ?? scheduled_at ?? created_at priority used by the
        // doctor/patient list screens, so this detail view agrees with them.
        const iso = (data as any).started_at ?? (data as any).scheduled_at ?? (data as any).created_at
        if (iso) setConsultationDate(new Date(iso))
      } catch {
        // best-effort — falls back to today's date if this fails
      }
    })()
    return () => { cancelled = true }
  }, [consultationId])

  useEffect(() => {
    if (!consultationId) { setReviewLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || !user?.id) { if (!cancelled) setReviewLoading(false); return }
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!userData?.id) { if (!cancelled) setReviewLoading(false); return }
        const { data: review } = await client
          .from('reviews')
          .select('id, rating, comment')
          .eq('consultation_id', consultationId)
          .eq('patient_id', userData.id)
          .maybeSingle()
        if (cancelled) return
        if (review) {
          setExistingReviewId(review.id)
          setRating(review.rating)
          setComment(review.comment ?? '')
        }
      } finally {
        if (!cancelled) setReviewLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [consultationId])

  useEffect(() => {
    if (!consultationId) { setSummaryLoading(false); return }
    let cancelled = false
    let attempts = 0

    // Retries transient failures (Clerk session still hydrating on cold
    // launch, brief network blip) instead of permanently showing "not
    // submitted yet" for a summary that actually exists — a fetch error is
    // never treated as "no summary."
    const fetchSummary = async () => {
      const token = await getToken()
      if (cancelled) return
      if (!token) {
        if (attempts < 5) { attempts += 1; setTimeout(fetchSummary, 400); return }
        setSummaryLoading(false)
        return
      }
      const { data, error } = await getAuthClient(token)
        .from('consultation_summaries')
        .select('chief_complaint,diagnosis,prescription,followup_recommendation,referral_needed,referral_specialty')
        .eq('consultation_id', consultationId)
        .maybeSingle()
      if (cancelled) return
      if (error && attempts < 3) { attempts += 1; setTimeout(fetchSummary, 600); return }
      setSummary(data)
      setSummaryLoading(false)
    }

    fetchSummary()

    // Live-refresh if the doctor edits the summary while this screen is
    // open — always show the latest version, never a stale cached copy.
    const channel = supabase
      .channel(`patient-summary-${consultationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_summaries', filter: `consultation_id=eq.${consultationId}` }, () => {
        attempts = 0
        fetchSummary()
      })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [consultationId])

  const dateStr = (consultationDate ?? new Date()).toLocaleDateString('en-US', {
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
    if (!comment.trim()) {
      setCommentError(true)
      return
    }
    setCommentError(false)
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

        if (userData?.id && finalDoctorId) {
          if (existingReviewId) {
            await client.from('reviews').update({
              rating,
              comment: comment.trim(),
            }).eq('id', existingReviewId)
          } else {
            const { data: inserted } = await client.from('reviews').insert({
              consultation_id: consultationId,
              patient_id: userData.id,
              doctor_id: finalDoctorId,
              rating,
              comment: comment.trim(),
            }).select('id').single()
            if (inserted?.id) setExistingReviewId(inserted.id)
          }
        }
      }
    } catch {
      // Review save is best-effort — still navigate on failure
    }

    setSubmitting(false)
    setEditingRating(false)
    setSuccessVisible(true)
  }

  const handleDownload = async () => {
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
  ${logoImgTag}
  <h1>DAWA — Consultation Summary</h1>
  <p class="sub">This document is a confidential medical record generated by the Dawa Health Platform.</p>

  <div class="meta">
    <div class="meta-item"><div class="meta-label">Doctor</div><div class="meta-value">${esc(displayDoctorName)}</div></div>
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
  ${summary?.referral_needed ? `<div class="referral">📋 Doctor recommends a specialist referral${summary?.referral_specialty ? ` (${esc(summary.referral_specialty)})` : ''}.</div>` : ''}

  <div class="footer">This summary was generated during a Dawa teleconsultation and is not a substitute for in-person emergency care. If you are experiencing a medical emergency, contact your local emergency services immediately.<br/>Powered by Dawa Health Platform · ${esc(dateStr)}</div>
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

      // Best-effort: persist the report to Supabase Storage so it's viewable
      // later on the web summary page too. Never blocks/delays the share above.
      persistReportToStorage(uri).catch(() => {})
    } catch {
      Alert.alert('Error', 'Could not generate PDF. Please try again.')
    }
  }

  const persistReportToStorage = async (fileUri: string) => {
    if (!consultationId) return
    const token = await getToken()
    if (!token) return
    const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 })
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const client = getAuthClient(token)
    const path = `${consultationId}/report.pdf`
    const { error: uploadError } = await client.storage
      .from('consultation-reports')
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) return
    await client.from('consultation_summaries').update({ report_pdf_path: path }).eq('consultation_id', consultationId)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
            {t('sessionEndedWith')} {displayDoctorName} {t('sessionEndedSuffix')}
          </Text>
        </LinearGradient>

        {/* Session details */}
        <View style={styles.detailCard}>
          <Row icon={typeIcon} label={typeLabel} value="" accent />
          <Divider />
          <Row icon="person-outline" label={t('doctorLabel')} value={displayDoctorName} photoUrl={displayDoctorPhotoUrl} />
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
                <Text style={styles.referralText}>
                  {summary?.referral_specialty
                    ? `${t('referralRecommended')} — ${summary.referral_specialty}`
                    : t('referralRecommended')}
                </Text>
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
          {!reviewLoading && existingReviewId && !editingRating ? (
            <>
              <Text style={styles.ratingTitle}>You have already rated this consultation</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map(star => (
                  <Ionicons
                    key={star}
                    name={star <= rating ? 'star' : 'star-outline'}
                    size={30}
                    color={star <= rating ? colors.warning : colors.steelGrey}
                  />
                ))}
              </View>
              {comment ? <Text style={styles.noteText}>{comment}</Text> : null}
              <View style={styles.editReviewRow}>
                <Pressable
                  style={({ pressed }) => [styles.editReviewBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => setEditingRating(true)}
                >
                  <Ionicons name="star-outline" size={16} color={colors.careBlue} />
                  <Text style={styles.editReviewText}>Edit Rating</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.editReviewBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => setEditingRating(true)}
                >
                  <Ionicons name="create-outline" size={16} color={colors.careBlue} />
                  <Text style={styles.editReviewText}>Edit Review</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.ratingTitle}>{t('rateYourDoctor')}</Text>
              <Text style={styles.ratingSub}>
                {t('howWasExperience')} {displayDoctorName}?
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
                style={[styles.commentInput, commentError && styles.commentInputError]}
                placeholder={t('leaveComment')}
                placeholderTextColor="#9CA3AF"
                value={comment}
                onChangeText={(v) => {
                  setComment(v)
                  if (commentError && v.trim()) setCommentError(false)
                }}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
                multiline
                maxLength={300}
              />
              {commentError ? (
                <Text style={styles.commentErrorText}>{t('commentRequiredError')}</Text>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* Done button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.doneWrap, pressed && { opacity: 0.88 }]}
          onPress={
            !reviewLoading && existingReviewId && !editingRating
              ? () => router.replace({ pathname: '/(patient)/(tabs)/appointments', params: { tab: 'past' } })
              : handleDone
          }
          disabled={submitting}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.doneBtn}
          >
            <Text style={styles.doneBtnText}>
              {submitting
                ? t('submitting')
                : !reviewLoading && existingReviewId && !editingRating
                  ? t('done')
                  : existingReviewId
                    ? 'Update Rating'
                    : t('submitAndDone')}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
      </KeyboardAvoidingView>

      <CareHubAlert
        visible={successVisible}
        variant="success"
        title={t('ratingSuccessTitle')}
        message={t('ratingSuccessMessage')}
        buttons={[{
          text: t('continueButton'),
          onPress: () => {
            setSuccessVisible(false)
            router.replace({ pathname: '/(patient)/(tabs)/appointments', params: { tab: 'past' } })
          },
        }]}
        onClose={() => setSuccessVisible(false)}
      />
    </SafeAreaView>
  )
}

function Row({ icon, label, value, accent, photoUrl }: {
  icon: string; label: string; value: string; accent?: boolean; photoUrl?: string | null
}) {
  return (
    <View style={rowStyles.row}>
      {photoUrl !== undefined ? (
        photoUrl ? (
          <Image source={{ uri: photoUrl }} style={rowStyles.avatar} />
        ) : (
          <View style={rowStyles.iconWrap}>
            <Ionicons name="person" size={16} color="#6B7280" />
          </View>
        )
      ) : (
        <View style={[rowStyles.iconWrap, accent && rowStyles.iconWrapAccent]}>
          <Ionicons name={icon as any} size={16} color={accent ? colors.tealGreen : '#6B7280'} />
        </View>
      )}
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
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.cloudGrey },
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
  commentInputError: { borderColor: colors.error },
  commentErrorText: { fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginTop: 6 },

  editReviewRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  editReviewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: colors.careBlue,
    backgroundColor: '#EFF6FF',
  },
  editReviewText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.careBlue },

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
