import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useSegments } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { formatDoctorName } from '@/lib/nameFormat'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { formatCallDuration } from '@/lib/callDuration'

const CONSULTATION_SEGMENTS = [
  'phone-consultation',
  'video-consultation',
  'chat-consultation',
]

export default function ActiveCallBanner() {
  const router = useRouter()
  const segments = useSegments()
  const insets = useSafeAreaInsets()
  const { isSignedIn } = useAuth()
  const { active } = useActiveConsultationStore()

  // Local display counter — continues from stored elapsed time
  const [displaySeconds, setDisplaySeconds] = useState(active?.elapsedSeconds ?? 0)

  // Pulse animation for the live dot
  const pulse = useRef(new Animated.Value(1)).current

  // Don't show when already on a consultation screen
  const isOnConsultation = segments.some(seg =>
    CONSULTATION_SEGMENTS.some(c => seg.includes(c))
  )

  // Resync the local display counter from the store's elapsedSeconds — which
  // is itself only ever written from real DB state (the call screen's own
  // useConsultationState timer while mounted, or app/_layout.tsx's recovery
  // effects computing from started_at) — every time it changes. This local
  // counter only exists to tick smoothly between those authoritative writes;
  // depending on elapsedSeconds (not just consultationId) means a resync on
  // app foreground/background, not a value left stale from before the app
  // was backgrounded or before the user briefly left the call screen.
  useEffect(() => {
    if (active) setDisplaySeconds(active.elapsedSeconds)
  }, [active?.consultationId, active?.elapsedSeconds])

  // Keep counting while call is active (but not reconnecting — time is paused)
  useEffect(() => {
    if (!active || !isSignedIn || isOnConsultation || active.status !== 'active') return
    const t = setInterval(() => setDisplaySeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [active?.consultationId, active?.status, isOnConsultation, isSignedIn])

  // Pulse the live dot
  useEffect(() => {
    if (!active || !isSignedIn || isOnConsultation) return
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [active?.consultationId, isOnConsultation, isSignedIn])

  // Not signed in — the persisted "active" state is device-scoped (AsyncStorage),
  // not account-scoped, so it can outlive a sign-out or account deletion. Never
  // show it before/without an authenticated session (see also clearAuth(), which
  // clears the store itself on sign-out/deletion so this is defense-in-depth).
  if (!active || !isSignedIn || isOnConsultation) return null

  const typeIcon = active.type === 'video' ? 'videocam' : active.type === 'phone' ? 'call' : 'chatbubble'
  const typeLabel =
    active.type === 'video' ? 'Video Consultation' :
    active.type === 'phone' ? 'Phone Consultation' : 'Chat Consultation'

  const handleTap = () => {
    const rolePrefix = active.role === 'patient' ? '/(patient)' : '/(doctor)'
    const ROUTE_MAP: Record<string, string> = {
      phone: `${rolePrefix}/phone-consultation`,
      video: `${rolePrefix}/video-consultation`,
      chat:  `${rolePrefix}/chat-consultation`,
    }
    const pathname = ROUTE_MAP[active.type]
    const nameKey = active.role === 'patient' ? 'doctorName' : 'patientName'
    router.push({
      pathname: pathname as any,
      params: {
        consultationId: active.consultationId,
        [nameKey]: active.otherPersonName,
        resumeElapsed: String(displaySeconds),
      },
    })
  }

  return (
    <Pressable
      style={[styles.container, { paddingTop: insets.top + 6 }]}
      onPress={handleTap}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
    >
      {/* Live indicator */}
      <View style={styles.liveDotWrapper}>
        <Animated.View
          style={[
            styles.liveDotRing,
            active.status === 'reconnecting' && styles.liveDotRingWarning,
            { transform: [{ scale: pulse }] },
          ]}
        />
        <View style={[styles.liveDot, active.status === 'reconnecting' && styles.liveDotWarning]} />
      </View>

      {/* Other person's photo — falls back to the type icon in a circle when
          no photo is on file, never a blank/broken image or a "profile
          unavailable" placeholder. */}
      {active.otherPersonPhotoUrl ? (
        <Image source={{ uri: active.otherPersonPhotoUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Ionicons name={typeIcon as any} size={13} color={colors.tealGreen} />
        </View>
      )}

      {/* Name + type */}
      <View style={styles.textBlock}>
        <Text style={styles.name} numberOfLines={1}>
          {active.role === 'patient' ? formatDoctorName(active.otherPersonName) : active.otherPersonName}
        </Text>
        <Text style={[styles.sub, active.status === 'reconnecting' && styles.subWarning]}>
          {active.status === 'reconnecting' ? 'Reconnecting…' : active.status === 'connecting' ? 'Connecting…' : typeLabel}
        </Text>
      </View>

      {/* Timer — only meaningful once both participants have actually
          joined; while still connecting there is no elapsed call time to
          show yet (status is set from the same DB-derived phase the call
          screen itself uses, not local Agora state). */}
      {active.status !== 'connecting' && (
        <Text style={[styles.timer, active.status === 'reconnecting' && styles.timerWarning]}>
          {formatCallDuration(displaySeconds)}
        </Text>
      )}

      {/* Tap to resume */}
      <View style={styles.resumeChip}>
        <Text style={styles.resumeText}>Resume</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#0B1535',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,191,165,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 10,
  },
  liveDotWrapper: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  liveDotRing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(0,191,165,0.3)',
  },
  liveDotRingWarning: {
    backgroundColor: 'rgba(251,191,36,0.3)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.tealGreen,
  },
  liveDotWarning: {
    backgroundColor: '#FBBF24',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  avatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,191,165,0.12)',
  },
  textBlock: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.mistWhite,
    lineHeight: 17,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 15,
  },
  subWarning: {
    color: '#FDE68A',
  },
  timer: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.tealGreen,
    marginRight: 10,
    letterSpacing: 0.5,
  },
  timerWarning: {
    color: '#FBBF24',
  },
  resumeChip: {
    backgroundColor: colors.tealGreen,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  resumeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#000',
  },
})
