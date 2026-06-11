import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useDoctorStore } from '@/store/doctorStore'

const STEPS = [
  { icon: 'search-outline', label: 'Admin reviews your credentials', color: colors.information },
  { icon: 'checkmark-circle-outline', label: 'You receive approval notification', color: colors.tealGreen },
  { icon: 'radio-button-on-outline', label: 'Go online and start consultations', color: colors.success },
] as const

export default function UnderReviewScreen() {
  const router = useRouter()
  const { clearReg } = useDoctorStore()
  const [checking, setChecking] = useState(false)
  const [showRejectionModal, setShowRejectionModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const handleCheckStatus = async () => {
    setChecking(true)
    // TODO: Replace with real Supabase query: doctor_profiles.status for current user
    setTimeout(() => {
      setChecking(false)
      // Simulate pending — swap to 'approved' or 'rejected' when wired to Supabase
      const mockStatus = 'pending' as string
      if (mockStatus === 'approved') {
        router.replace('/(doctor)/(tabs)/home')
      } else if (mockStatus === 'rejected') {
        setRejectionReason('License number could not be verified. Please reapply with a valid medical license.')
        setShowRejectionModal(true)
      } else {
        Alert.alert('Still Under Review', 'Your application is being reviewed. Check back in 24–48 hours.')
      }
    }, 1200)
  }

  const handleReapply = () => {
    setShowRejectionModal(false)
    clearReg()
    router.replace('/(doctor)/registration/step-1')
  }

  const handleSupport = () => {
    Linking.openURL('mailto:support@carehub.app?subject=Doctor%20Application%20Help')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Illustration area */}
        <View style={styles.illustrationWrap}>
          {/* Hourglass circle */}
          <View style={styles.hourglassCircle}>
            <LinearGradient
              colors={['#EFF6FF', '#F0FDFB']}
              style={styles.hourglassGradient}
            >
              <Ionicons name="hourglass-outline" size={72} color={colors.careBlue} />
            </LinearGradient>
          </View>
          {/* Green checkmark badge */}
          <View style={styles.checkBadge}>
            <LinearGradient colors={gradients.interactive} style={styles.checkBadgeGrad}>
              <Ionicons name="checkmark" size={18} color={colors.mistWhite} />
            </LinearGradient>
          </View>
        </View>

        <Text style={styles.title}>Application Submitted!</Text>
        <Text style={styles.subtitle}>
          Our team will review your documents within{' '}
          <Text style={styles.subtitleBold}>24–48 hours</Text>. You will receive an email and notification once your account is approved.
        </Text>

        {/* Divider */}
        <View style={styles.divider} />

        {/* What happens next */}
        <Text style={styles.sectionTitle}>What happens next?</Text>
        <View style={styles.stepsWrap}>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepIconWrap, { backgroundColor: `${step.color}18` }]}>
                <Ionicons name={step.icon as never} size={20} color={step.color} />
              </View>
              <Text style={styles.stepLabel}>{step.label}</Text>
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Need help */}
        <Pressable onPress={handleSupport} style={styles.helpRow}>
          <Ionicons name="help-circle-outline" size={18} color={colors.tealGreen} />
          <Text style={styles.helpText}>Need help?{' '}<Text style={styles.helpLink}>Contact support</Text></Text>
        </Pressable>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Check status button */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleCheckStatus}
          disabled={checking}
          style={({ pressed }) => [styles.checkStatusBtn, pressed && { opacity: 0.8 }]}
        >
          {checking ? (
            <ActivityIndicator color={colors.careBlue} size="small" />
          ) : (
            <>
              <Ionicons name="refresh-outline" size={18} color={colors.careBlue} />
              <Text style={styles.checkStatusText}>Check Application Status</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Rejection Modal */}
      <Modal visible={showRejectionModal} transparent animationType="slide" onRequestClose={() => setShowRejectionModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowRejectionModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.rejectionIconWrap}>
              <Ionicons name="close-circle" size={40} color={colors.error} />
            </View>
            <Text style={styles.rejectionTitle}>Application Not Approved</Text>
            <View style={styles.rejectionReasonCard}>
              <Text style={styles.rejectionReasonLabel}>Reason:</Text>
              <Text style={styles.rejectionReasonText}>{rejectionReason}</Text>
            </View>
            <GradientButton label="Reapply" onPress={handleReapply} />
            <View style={styles.modalSpacer} />
            <OutlineButton label="Contact Support" onPress={handleSupport} />
            <View style={{ height: 8 }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  scroll: { paddingHorizontal: 24, paddingTop: 40, alignItems: 'center' },

  illustrationWrap: { position: 'relative', marginBottom: 28 },
  hourglassCircle: {
    width: 150, height: 150, borderRadius: 75,
    overflow: 'hidden',
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 20, elevation: 4,
  },
  hourglassGradient: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  checkBadge: {
    position: 'absolute', bottom: 6, right: 6,
    borderRadius: 18, overflow: 'hidden',
    shadowColor: colors.tealGreen, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 3,
  },
  checkBadgeGrad: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },

  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  subtitleBold: { fontFamily: fonts.bold, color: colors.inkBlack },

  divider: { width: '100%', height: 1, backgroundColor: colors.cloudGrey, marginVertical: 20 },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, alignSelf: 'flex-start', marginBottom: 16 },
  stepsWrap: { width: '100%', gap: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack, flex: 1 },

  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpText: { fontFamily: fonts.regular, fontSize: 14, color: '#6B7280' },
  helpLink: { fontFamily: fonts.semiBold, color: colors.tealGreen },

  footer: {
    paddingHorizontal: 24, paddingBottom: 32, paddingTop: 12,
    backgroundColor: colors.mistWhite, borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  checkStatusBtn: {
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.steelGrey,
    backgroundColor: colors.mistWhite, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  checkStatusText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.careBlue },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24,
  },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  rejectionIconWrap: { alignItems: 'center', marginBottom: 12 },
  rejectionTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.error, textAlign: 'center', marginBottom: 16 },
  rejectionReasonCard: { backgroundColor: '#FFF5F5', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#FECACA' },
  rejectionReasonLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.error, marginBottom: 6 },
  rejectionReasonText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, lineHeight: 20 },
  modalSpacer: { height: 12 },
})
