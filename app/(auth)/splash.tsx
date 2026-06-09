import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { CareHubLogo } from '@/components/ui/CareHubLogo';
import { colors } from '@/constants/colors';

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/(auth)/country');
    }, 2500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View className="flex-1 bg-[#070E27]">
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
      <View className="flex-1 items-center justify-center px-6">
        <CareHubLogo />

        {/* CARE (white) + HUB (teal) */}
        <View className="flex-row items-baseline mt-6">
          <Text className="font-montserrat-bold text-[42px] text-white tracking-[2px]">CARE</Text>
          <Text className="font-montserrat-bold text-[42px] text-teal-green tracking-[2px]">HUB</Text>
        </View>

        {/* Tagline */}
        <Text className="font-montserrat text-[13px] text-white/70 tracking-[1.5px] mt-2 text-center">
          TRUSTED CARE. ANYWHERE. ALWAYS.
        </Text>

        {/* Spinner */}
        <ActivityIndicator
          size={40}
          color={colors.active}
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
