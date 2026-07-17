import { useAuth } from '@clerk/clerk-expo'
import { supabase } from '@/lib/supabase'
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { images } from '@/constants/images';
import { colors } from '@/constants/colors';
import { PENDING_PAYMENT_KEY, type PendingPayment } from '@/lib/pendingPayment';
import { useAuthStore } from '@/store/authStore';
import { resolveActiveConsultationRoute } from '@/lib/activeConsultationRecovery';

// Clerk's isLoaded flips true once the SDK has initialized, but on a device
// that previously had a session, the actual session restore (reading the
// rotating client JWT back out of storage) can still be resolving for a
// moment after that. If we trust isSignedIn=false the instant isLoaded
// flips, a returning user can get misrouted into country/language/sign-in —
// screens with no way back to Home — even though they're really still
// signed in. Since store/authStore.ts persists userId across app restarts,
// a cached userId here means this device was previously authenticated, so
// we give Clerk a brief grace window to finish restoring before concluding
// the user is genuinely signed out.
const SIGNED_OUT_RETRY_MS = 400
const MAX_SIGNED_OUT_RETRIES = 6 // ~2.4s total grace window

export default function SplashScreen() {
  const router = useRouter();
  const { isSignedIn, isLoaded, userId: clerkUserId } = useAuth()
  const { userRole, userId: cachedUserId, setUserRole } = useAuthStore()
  const [timerDone, setTimerDone] = useState(false);
  const [signedOutRetries, setSignedOutRetries] = useState(0);
  const navigatedRef = useRef(false);

  // Always show splash for at least 2500ms
  useEffect(() => {
    const timer = setTimeout(() => setTimerDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Navigate once both the timer has elapsed and Clerk has initialized
  useEffect(() => {
    if (!timerDone || !isLoaded || navigatedRef.current) return

    // A cold-launch push notification tap (e.g. a doctor's incoming-request
    // alert) already pushed its own destination on top of this screen — that
    // happens synchronously well before this timer fires. Deferring here
    // stops this effect from later replacing that screen with Home, which
    // otherwise flashes Home in between the notification tap and the actual
    // consultation screen opening.
    if (useAuthStore.getState().pendingNotificationRoute) {
      useAuthStore.getState().setPendingNotificationRoute(false)
      navigatedRef.current = true
      return
    }

    const navigate = async () => {
      // Guards against this effect firing more than once: it re-runs whenever
      // `userRole` changes, and this same async function calls setUserRole()
      // below — without this guard that state update would re-trigger a
      // second, redundant navigation on top of whatever screen is now active.
      navigatedRef.current = true

      if (!isSignedIn) {
        if (cachedUserId && signedOutRetries < MAX_SIGNED_OUT_RETRIES) {
          navigatedRef.current = false // haven't actually navigated yet — allow the retry re-run
          setTimeout(() => setSignedOutRetries((n) => n + 1), SIGNED_OUT_RETRY_MS)
          return
        }
        router.replace('/(auth)/country' as never)
        return
      }

      // A Chapa payment may still be verifying — this marker survives even a
      // full app kill (e.g. the external banking-app hand-off suspended us
      // mid-flow). Route straight back to payment-return so the patient
      // always sees verification/confirmation, never a Home flash in between.
      try {
        const raw = await AsyncStorage.getItem(PENDING_PAYMENT_KEY)
        if (raw) {
          const pending = JSON.parse(raw) as PendingPayment
          if (pending?.consultationId) {
            router.replace({
              pathname: '/(patient)/payment-return' as any,
              params: {
                consultationId:   pending.consultationId,
                doctorId:         pending.doctorId,
                doctorName:       pending.doctorName,
                consultationType: pending.consultationType,
                timing:           pending.timing,
                scheduledAt:      pending.scheduledAt,
                chapaStatus:      'unknown',
              },
            })
            return
          }
        }
      } catch {}

      // Always query Supabase for the authoritative role — don't rely on Zustand alone
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('id, role')
          .eq('clerk_id', clerkUserId!)
          .single()

        if (userData?.role === 'patient') {
          setUserRole('patient')
          // Check for an active consultation BEFORE landing on Home — a
          // returning patient with a live/waiting consultation must go
          // straight there (Splash → Consultation), never flash Home first.
          const active = await resolveActiveConsultationRoute(supabase, 'patient', userData.id).catch(() => null)
          if (active) {
            router.replace({ pathname: active.pathname as any, params: active.params })
          } else {
            router.replace('/(patient)/(tabs)/home' as never)
          }
        } else if (userData?.role === 'doctor') {
          setUserRole('doctor')
          try {
            const { data: dp } = await supabase
              .from('doctor_profiles')
              .select('status')
              .eq('user_id', userData.id)
              .single()

            if (dp?.status === 'approved') {
              // Same check for a returning doctor — an active/waiting
              // consultation must open directly, never behind Home.
              const active = await resolveActiveConsultationRoute(supabase, 'doctor', userData.id).catch(() => null)
              if (active) {
                router.replace({ pathname: active.pathname as any, params: active.params })
              } else {
                router.replace('/(doctor)/(tabs)/home' as never)
              }
            } else if (dp?.status === 'pending') {
              router.replace('/(doctor)/registration/under-review' as never)
            } else if (dp?.status === 'rejected' || dp?.status === 'suspended') {
              router.replace('/(doctor)/registration/under-review' as never)
            } else {
              router.replace('/(doctor)/registration/step-1' as never)
            }
          } catch {
            router.replace('/(doctor)/registration/step-1' as never)
          }
        } else {
          // No row or unrecognised role — new user who hasn't finished signup
          router.replace('/(auth)/role' as never)
        }
      } catch {
        // Network error — fall back to cached Zustand role
        if (userRole === 'patient') {
          router.replace('/(patient)/(tabs)/home' as never)
        } else if (userRole === 'doctor') {
          router.replace('/(doctor)/(tabs)/home' as never)
        } else {
          router.replace('/(auth)/country' as never)
        }
      }
    }

    navigate()
  }, [timerDone, isLoaded, isSignedIn, userRole, cachedUserId, signedOutRetries])

  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor="transparent" translucent />

      {/* Bottom-left blue radial glow */}
      <LinearGradient
        colors={['rgba(26, 69, 152, 0.65)', 'transparent']}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={styles.glowBottomLeft}
      />

      {/* Top-right teal radial glow */}
      <LinearGradient
        colors={['rgba(0, 191, 165, 0.5)', 'transparent']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.glowTopRight}
      />

      {/* Decorative outline medical icons — StyleSheet required for transform arrays */}
      <MaterialCommunityIcons
        name="stethoscope"
        size={200}
        color="#FFFFFF"
        style={styles.iconTopLeft}
      />
      <MaterialCommunityIcons
        name="stethoscope"
        size={170}
        color="#FFFFFF"
        style={styles.iconMiddleLeft}
      />
      <MaterialCommunityIcons
        name="stethoscope"
        size={190}
        color="#FFFFFF"
        style={styles.iconBottomRight}
      />

      {/* Main content — vertically centered */}
      <View style={styles.content}>
        <Image
          source={images.darkLogo}
          style={styles.logoImage}
          resizeMode="contain"
        />

        {/* DA (white) + WA (teal) */}
        <View className="flex-row items-baseline mt-6">
          <Text className="font-montserrat-bold text-[42px] text-white tracking-[2px]">DA</Text>
          <Text className="font-montserrat-bold text-[42px] text-teal-green tracking-[2px]">WA</Text>
        </View>

        {/* Tagline */}
        <Text className="font-montserrat text-[13px] text-white/70 tracking-[1.5px] mt-2 text-center">
          TRUSTED CARE. ANYWHERE. ALWAYS.
        </Text>

        {/* Spinner */}
        <ActivityIndicator
          size={40}
          color={colors.tealGreen}
          className="mt-[52px]"
        />

        {/* Loading text */}
        <Text className="font-montserrat text-[14px] text-white/60 mt-4 text-center">
          Loading your care experience...
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070E27',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoImage: {
    width: 130,
    height: 130,
    borderRadius: 28,
  },
  glowBottomLeft: {
    position: 'absolute',
    width: 440,
    height: 440,
    borderRadius: 220,
    bottom: -160,
    left: -150,
  },
  glowTopRight: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -90,
    right: -90,
  },
  iconTopLeft: {
    position: 'absolute',
    top: -10,
    left: -55,
    opacity: 0.09,
    transform: [{ rotate: '15deg' }],
  },
  iconMiddleLeft: {
    position: 'absolute',
    top: '38%',
    left: -65,
    opacity: 0.08,
  },
  iconBottomRight: {
    position: 'absolute',
    bottom: 30,
    right: -55,
    opacity: 0.09,
    transform: [{ rotate: '-25deg' }],
  },
});
