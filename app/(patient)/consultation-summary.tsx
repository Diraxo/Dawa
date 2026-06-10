import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import {
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
import { ALL_DOCTORS } from '@/lib/mockDoctors'

const TYPE_LABELS: Record<string, string> = {
  chat: 'Chat Consultation',
  phone: 'Phone Call',
  video: 'Video Call',
}

const TYPE_ICONS: Record<string, string> = {
  chat: 'chatbubble-ellipses',
  phone: 'call',
  video: 'videocam',
}

export default function ConsultationSummaryScreen() {
  const { doctorId, doctorName, consultationType } = useLocalSearchParams<{
    doctorId: string
    doctorName: string
    consultationType: string
  }>()
  const router = useRouter()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')

  const doctor = ALL_DOCTORS.find(d => d.id === doctorId)
  const duration = Math.floor(Math.random() * 25) + 10 // Mock: 10-35 min
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const typeLabel = TYPE_LABELS[consultationType ?? 'chat'] ?? 'Consultation'
  const typeIcon = TYPE_ICONS[consultationType ?? 'chat'] ?? 'medical'

  const handleDone = () => {
    if (rating === 0) {
      Alert.alert('Rate Your Experience', 'Please rate your consultation before submitting.')
      return
    }
    Alert.alert('Thank you!', 'Your rating has been submitted.', [
      {
        text: 'Done',
        onPress: () => router.replace('/(patient)/(tabs)/home'),
      },
    ])
  }

  const handleDownload = () => {
    Alert.alert('Download Summary', 'PDF download will be available soon.')
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
          <Text style={styles.heroTitle}>Consultation Complete</Text>
          <Text style={styles.heroSub}>Your session with {doctorName ?? doctor?.name} has ended</Text>
        </LinearGradient>

        {/* Session details */}
        <View style={styles.detailCard}>
          <Row icon={typeIcon} label={typeLabel} value="" accent />
          <Divider />
          <Row icon="person-outline" label="Doctor" value={doctorName ?? doctor?.name ?? '—'} />
          <Row icon="calendar-outline" label="Date" value={dateStr} />
          <Row icon="time-outline" label="Duration" value={`${duration} minutes`} />
        </View>

        {/* Clinical notes (mock) */}
        <SectionCard title="Chief Complaint">
          <Text style={styles.noteText}>Patient reported recurring headaches for 3 days, described as pressure behind the eyes, worse in the morning.</Text>
        </SectionCard>

        <SectionCard title="Diagnosis">
          <Text style={styles.noteText}>Tension-type headache. Likely related to stress and dehydration. No red flags identified.</Text>
        </SectionCard>

        <SectionCard title="Prescription">
          <View style={styles.rxRow}>
            <Ionicons name="medical" size={14} color={colors.careBlue} />
            <Text style={styles.rxText}>Paracetamol 500mg — twice daily as needed for 3 days</Text>
          </View>
          <View style={styles.rxRow}>
            <Ionicons name="water" size={14} color={colors.tealGreen} />
            <Text style={styles.rxText}>Increase water intake to 2-3 liters per day</Text>
          </View>
        </SectionCard>

        <SectionCard title="Follow-up Recommendation">
          <Text style={styles.noteText}>Return if headaches persist beyond one week or worsen in intensity. No referral needed at this time.</Text>
        </SectionCard>

        {/* Download button */}
        <Pressable
          style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDownload}
        >
          <Ionicons name="download-outline" size={18} color={colors.careBlue} />
          <Text style={styles.downloadText}>Download as PDF</Text>
        </Pressable>

        {/* Rating section */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>Rate Your Doctor</Text>
          <Text style={styles.ratingSub}>How was your experience with {doctorName ?? 'the doctor'}?</Text>
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
            placeholder="Leave a comment (optional)..."
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
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.doneBtn}
          >
            <Text style={styles.doneBtnText}>Submit & Done</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function Row({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
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
    shadowColor: colors.tealGreen, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 6,
  },
  heroTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, marginBottom: 6, textAlign: 'center' },
  heroSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280', textAlign: 'center' },

  detailCard: {
    marginHorizontal: 20, marginBottom: 16,
    borderRadius: 14, borderWidth: 1, borderColor: colors.steelGrey, padding: 16,
  },

  noteText: { fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 22 },

  rxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  rxText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: '#374151', lineHeight: 20 },

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
