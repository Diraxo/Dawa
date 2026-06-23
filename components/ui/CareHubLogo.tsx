import { Image, StyleSheet } from 'react-native'

import { images } from '@/constants/images'

type Props = {
  size?: number
  /** 'light' = white logo for dark/gradient backgrounds (default). 'dark' = dark logo for white/light backgrounds. */
  variant?: 'light' | 'dark'
}

export function CareHubLogo({ size = 130, variant = 'light' }: Props) {
  return (
    <Image
      source={variant === 'dark' ? images.darkLogo : images.whiteLogo}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
      resizeMode="contain"
    />
  )
}

const styles = StyleSheet.create({})
