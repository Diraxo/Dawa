import { Image, StyleSheet, View } from 'react-native'

import { images } from '@/constants/images'

type Props = {
  size?: number
}

// The CareHub logo (hands holding a teal heart) inside a white rounded square
// so it reads on both the dark splash screen and light auth screens.
export function CareHubLogo({ size = 130 }: Props) {
  const borderRadius = Math.round(size * 0.22)
  const inner = Math.round(size * 0.74)

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius }]}>
      <Image
        source={images.logo}
        style={{ width: inner, height: inner }}
        resizeMode="contain"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
})
