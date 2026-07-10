import { useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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
import { useTranslation } from 'react-i18next'

import { GradientButton } from '@/components/ui/GradientButton'
import { OutlineButton } from '@/components/ui/OutlineButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

export default function UnderReviewScreen() {
  const router = useRouter()
  const { user } = useUser()
  const { clearReg } = useDoctorStore()
  const { t } = useTranslation()

  const STEPS = [
    { icon: 'search-outline', label: t('reviewStep1'), color: colors.information },
    { icon: 'checkmark-circle-outline', label: t('reviewStep2'), color: colors.tealGreen },
    { icon: 'radio-button-on-outline', label: t('reviewStep3'), color: colors.success },
  ] as const
  const [checking, setChecking] = useState(false)
  const [showRejectionModal, setShowRejectionModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [profileId, setProfileId] = useState<string | null>(null)

  // Fetch this doctor's profile ID so we can filter the Realtime subscription
  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('doctor_profiles')
      .select('id, users!inner(clerk_id)')
      .eq('users.clerk_id' as any, user.id)
      .maybeSingle()
      .then(({ data }) => { if (data?.id) setProfileId(data.id) })
  }, [user?.id])

  // Automatically react when admin approves or rejects — filtered to this doctor only
  useEffect(() => {
    if (!profileId) return

    const channel = supabase
      .channel(`doctor-approval-${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'doctor_profiles',
          filter: `id=eq.${profileId}`,
        },
        (payload) => {
          const updated = payload.new as { status: string; rejection_reason?: string }
          if (updated.status === 'approved') {
            clearReg()
            router.replace('/(doctor)/(tabs)/home')
          } else if (updated.status === 'rejected') {
            setRejectionReason(
              updated.rejection_reason ?? 'Your application was not approved. Please reapply with valid documents.'
            )
            setShowRejectionModal(true)
          } else if (updated.status === 'suspended') {
            Alert.alert('Account Suspended', 'Your account has been suspended. Please contact support.')
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profileId])

  const handleCheckStatus = async () => {
    if (checking) return
    setChecking(true)
    try {
      const { data: profile, error } = await supabase
        .from('doctor_profiles')
        .select('status, rejection_reason, user:users!inner(clerk_id)')
        .eq('users.clerk_id', user?.id ?? '')
        .maybeSingle()

      if (error) throw error

      if (profile?.status === 'approved') {
        clearReg()
        router.replace('/(doctor)/(tabs)/home')
      } else if (profile?.status === 'rejected') {
        setRejectionReason(
          profile.rejection_reason ?? 'Your application was not approved. Please reapply with valid documents.'
        )
        setShowRejectionModal(true)
      } else if (profile?.status === 'suspended') {
        Alert.alert('Account Suspended', 'Your account has been suspended. Please contact support.')
      } else {
        Alert.alert(t('stillUnderReview'), t('stillUnderReviewMsg'))
      }
    } catch {
      Alert.alert(t('connectionError'), t('connectionErrorMsg'))
    } finally {
      setChecking(false)
    }
  }

  const handleReapply = () => {
    setShowRejectionModal(false)
    clearReg()
    router.replace('/(doctor)/registration/step-1')
  }

  const handleSupport = () => {
    Linking.openURL('mailto:support@dawa.app?subject=Doctor%20Application%20Help')
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

        <Text style={styles.title}>{t('applicationSubmitted')}</Text>
        <Text style={styles.subtitle}>{t('underReviewSubtitle')}</Text>

        {/* Divider */}
        <View style={styles.divider} />

        {/* What happens next */}
        <Text style={styles.sectionTitle}>{t('whatHappensNext')}</Text>
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
          <Text style={styles.helpText}>{t('needHelp')}{' '}<Text style={styles.helpLink}>{t('contactSupport')}</Text></Text>
        </Pressable>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Footer buttons */}
      <View style={styles.footer}>
        <GradientButton
          label={t('goHome')}
          onPress={() => router.replace('/(doctor)/(tabs)/home')}
        />
        <View style={{ height: 10 }} />
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
              <Text style={styles.checkStatusText}>{t('checkApplicationStatus')}</Text>
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
            <Text style={styles.rejectionTitle}>{t('applicationNotApproved')}</Text>
            <View style={styles.rejectionReasonCard}>
              <Text style={styles.rejectionReasonLabel}>{t('reason')}</Text>
              <Text style={styles.rejectionReasonText}>{rejectionReason}</Text>
            </View>
            <GradientButton label={t('reapply')} onPress={handleReapply} />
            <View style={styles.modalSpacer} />
            <OutlineButton label={t('contactSupport')} onPress={handleSupport} />
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
    ...shadow(colors.careBlue, 0, 8, 20, 0.12, 4),
  },
  hourglassGradient: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  checkBadge: {
    position: 'absolute', bottom: 6, right: 6,
    borderRadius: 18, overflow: 'hidden',
    ...shadow(colors.tealGreen, 0, 2, 6, 0.35, 3),
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
