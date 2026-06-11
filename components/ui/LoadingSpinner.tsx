import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients } from '@/constants/gradients';

type Props = {
  size?: number;
};

export function LoadingSpinner({ size = 44 }: Props) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const strokeWidth = 3;
  const innerSize = size - strokeWidth * 2;

  return (
    <Animated.View style={{ transform: [{ rotate: spin }], width: size, height: size }}>
      {/* Gradient ring: full disc gradient, then white cutout to form the ring */}
      <LinearGradient
        colors={gradients.interactive}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
      >
        {/* White inner circle to create the donut ring */}
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: '#FFFFFF',
          }}
        />
        {/* Gap: cover top-right quarter to create open-arc illusion */}
        <View style={[styles.gap, { width: size / 2, height: size / 2 }]} />
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
  },
});
