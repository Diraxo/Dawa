import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { createConsultationChannel } from '@/lib/stream'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'
import { useTranslation } from 'react-i18next'

export default function IncomingRequestScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { userId } = useAuthStore()

  const {
    patientName,
    patientId,
    patientClerkId,
    consultationType,
    consultationId,
  } = useLocalSearchParams<{
    patientName:       string
    patientId?:        string
    patientClerkId?:   string
    consultationType:  string
    consultationId?:   string
    waitingStartedAt?: string // kept for backwards compat, no longer used
  }>()

  const TYPE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
    chat:  { icon: 'chatbubble-ellipses', label: t('chatConsultation'),  color: colors.tealGreen, bg: 'rgba(0,191,165,0.15)' },
    phone: { icon: 'call',                label: t('phoneConsultation'), color: colors.careBlue,  bg: 'rgba(26,69,152,0.15)' },
    video: { icon: 'videocam',            label: t('videoConsultation'), color: '#7C3AED',         bg: 'rgba(124,58,237,0.15)' },
  }

  const meta = TYPE_META[consultationType ?? 'chat'] ?? TYPE_META.chat
  const [responded, setResponded] = useState(false)
  const navigatedRef = useRef(false)

  // ── Realtime: dismiss if patient cancels before doctor responds ──────────
  useEffect(() => {
    if (!consultationId) return
    const channel = supabase
      .channel(`incoming-request-${consultationId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}` },
        (payload) => {
          const status: string = (payload.new as any)?.status ?? ''
          if (responded || navigatedRef.current) return
          if (status === 'cancelled') {
            navigatedRef.current = true
            setResponded(true)
            Alert.alert(
              t('requestCancelled'),
              t('patientCancelledRequest'),
              [{ text: t('ok'), onPress: () => router.canGoBack() ? router.back() : router.replace('/(doctor)/(tabs)/home' as never) }],
            )
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [consultationId, responded])

  const updateStatus = async (id: string, status: 'accepted' | 'declined') => {
    try {
      const token = await getToken()
      if (!token || !id) return
      const update: Record<string, unknown> = { status }
      if (status === 'accepted') update.started_at = new Date().toISOString()
      await getAuthClient(token).from('consultations').update(update).eq('id', id)
    } catch {
      // best effort
    }
  }

  const handleDecline = () => {
    Alert.alert(
      t('declineRequest'),
      `${t('areYouSureDecline')} ${patientName ?? 'this patient'}'s request?`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('decline'),
          style: 'destructive',
          onPress: async () => {
            if (navigatedRef.current) return
            navigatedRef.current = true
            setResponded(true)
            if (consultationId) await updateStatus(consultationId, 'declined')
            router.canGoBack()
              ? router.back()
              : router.replace('/(doctor)/(tabs)/home' as never)
          },
        },
      ],
    )
  }

  const handleAccept = async () => {
    if (!consultationId) {
      Alert.alert('Error', 'No consultation ID found. Please try again.')
      return
    }
    if (navigatedRef.current) return

    // Verify payment before accepting
    try {
      const token = await getToken()
      if (!token) {
        Alert.alert('Error', 'Authentication error. Please try again.')
        return
      }
      const { data: chk } = await getAuthClient(token)
        .from('consultations')
        .select('payment_status')
        .eq('id', consultationId)
        .single()
      if (chk?.payment_status !== 'paid') {
        Alert.alert('Payment Pending', 'Payment has not been confirmed yet. Please wait a moment.')
        return
      }
    } catch {
      // proceed if check fails
    }

    navigatedRef.current = true
    setResponded(true)
    await updateStatus(consultationId, 'accepted')

    // Create the Stream channel so chat is available after acceptance.
    // Stream user IDs are Clerk IDs — never fall back to Supabase UUIDs.
    try {
      const doctorUserId = userId ?? user?.id ?? ''
      if (!patientClerkId) {
        logger.error('[Stream] patientClerkId missing — channel not created for consultation:', consultationId)
      } else if (doctorUserId) {
        await createConsultationChannel(consultationId, patientClerkId, doctorUserId, {
          doctorName:     user?.fullName ?? user?.firstName ?? 'Doctor',
          doctorSubtitle: '',
          doctorPhotoUrl: user?.imageUrl ?? null,
        })
      }
    } catch {
      // channel might already exist
    }

    const params = {
      patientName:    patientName ?? 'Patient',
      patientId:      patientId ?? '',
      consultationId,
      channelId:      consultationId,
    }
    const route =
      consultationType === 'phone'
        ? '/(doctor)/phone-consultation'
        : consultationType === 'video'
          ? '/(doctor)/video-consultation'
          : '/(doctor)/chat-consultation'

    router.replace({ pathname: route as any, params })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top badge */}
      <View style={styles.topRow}>
        <View style={[styles.typeBadge, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon as any} size={16} color={meta.color} />
          <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        <Text style={styles.incomingLabel}>{t('incomingRequest')}</Text>

        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={56} color="rgba(255,255,255,0.5)" />
        </View>

        <Text style={styles.patientName}>{patientName ?? 'Patient'}</Text>
        <Text style={styles.patientSub}>
          {t('wantsToStartA')} {meta.label.toLowerCase()}
        </Text>

        {/* Payment confirmed badge */}
        <View style={styles.paymentBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.paymentBadgeText}>Payment Confirmed</Text>
        </View>

        {/* Consultation info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={15} color="rgba(255,255,255,0.5)" />
            <Text style={styles.infoLabel}>Patient</Text>
            <Text style={styles.infoValue}>{patientName ?? 'Patient'}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name={meta.icon as any} size={15} color={meta.color} />
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={[styles.infoValue, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={15} color={colors.success} />
            <Text style={styles.infoLabel}>Payment</Text>
            <Text style={[styles.infoValue, { color: colors.success }]}>Paid</Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.75 }]}
          onPress={handleDecline}
          disabled={responded}
        >
          <Ionicons name="close" size={28} color={colors.error} />
          <Text style={styles.declineLabel}>{t('decline')}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.acceptWrap, pressed && { opacity: 0.88 }, responded && { opacity: 0.5 }]}
          onPress={handleAccept}
          disabled={responded}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.acceptBtn}
          >
            <Ionicons name="checkmark" size={28} color={colors.mistWhite} />
            <Text style={styles.acceptLabel}>{t('accept')}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070E27' },

  topRow: { alignItems: 'center', paddingTop: 20 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  typeBadgeText: { fontFamily: fonts.semiBold, fontSize: 13 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },

  incomingLabel: {
    fontFamily: fonts.medium, fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },

  avatarCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.tealGreen,
    ...shadow(colors.tealGreen, 0, 0, 20, 0.4, 10),
  },

  patientName: {
    fontFamily: fonts.bold, fontSize: 26, color: colors.mistWhite,
    textAlign: 'center',
  },
  patientSub: {
    fontFamily: fonts.regular, fontSize: 14,
    color: 'rgba(255,255,255,0.6)', textAlign: 'center',
  },

  paymentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(56,161,105,0.15)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(56,161,105,0.3)',
  },
  paymentBadgeText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.success },

  infoCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  infoRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  infoLabel:   { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  infoValue:   { fontFamily: fonts.semiBold, fontSize: 13, color: colors.mistWhite },
  infoDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 20, paddingHorizontal: 32, paddingBottom: 40,
  },

  declineBtn: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(211,47,47,0.15)',
    borderWidth: 2, borderColor: colors.error,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  declineLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.error },

  acceptWrap: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden' },
  acceptBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4,
    ...shadow(colors.tealGreen, 0, 4, 12, 0.5, 8),
  },
  acceptLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.mistWhite },
})
