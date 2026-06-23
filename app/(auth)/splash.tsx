import { useAuth } from '@clerk/clerk-expo'
import { supabase } from '@/lib/supabase'
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { images } from '@/constants/images';
import { colors } from '@/constants/colors';
import { useAuthStore } from '@/store/authStore';

export default function SplashScreen() {
  const router = useRouter();
  const { isSignedIn, isLoaded, userId: clerkUserId } = useAuth()
  const { userRole, setUserRole } = useAuthStore()
  const [timerDone, setTimerDone] = useState(false);

  // Always show splash for at least 2500ms
  useEffect(() => {
    const timer = setTimeout(() => setTimerDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Navigate once both the timer has elapsed and Clerk has initialized
  useEffect(() => {
    if (!timerDone || !isLoaded) return

    const navigate = async () => {
      if (!isSignedIn) {
        router.replace('/(auth)/country' as never)
        return
      }

      // Always query Supabase for the authoritative role — don't rely on Zustand alone
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('id, role')
          .eq('clerk_id', clerkUserId!)
          .single()

        if (userData?.role === 'patient') {
          setUserRole('patient')
          router.replace('/(patient)/(tabs)/home' as never)
        } else if (userData?.role === 'doctor') {
          setUserRole('doctor')
          try {
            const { data: dp } = await supabase
              .from('doctor_profiles')
              .select('status')
              .eq('user_id', userData.id)
              .single()

            if (dp?.status === 'approved') {
              router.replace('/(doctor)/(tabs)/home' as never)
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
  }, [timerDone, isLoaded, isSignedIn, userRole])

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
