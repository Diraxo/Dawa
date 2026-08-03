import { Platform } from 'react-native'

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean
  const r = parseInt(full.substring(0, 2), 16) || 0
  const g = parseInt(full.substring(2, 4), 16) || 0
  const b = parseInt(full.substring(4, 6), 16) || 0
  return `${r},${g},${b}`
}

/**
 * Returns platform-correct shadow styles.
 * On web: returns { boxShadow } (react-native-web ≥0.19 standard).
 * On native: returns shadowColor/shadowOffset/shadowOpacity/shadowRadius/elevation.
 *
 * Usage inside StyleSheet.create:
 *   card: { borderRadius: 16, ...shadow('#000', 0, 2, 8, 0.08, 2) }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shadow(
  color: string = '#000',
  offsetX: number = 0,
  offsetY: number = 2,
  blur: number = 8,
  opacity: number = 0.08,
  elevation: number = 2,
): any {
  if (Platform.OS === 'web') {
    const rgb = hexToRgb(color)
    return { boxShadow: `${offsetX}px ${offsetY}px ${blur}px rgba(${rgb},${opacity})` }
  }
  return {
    shadowColor: color,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: blur,
    elevation,
  }
}
