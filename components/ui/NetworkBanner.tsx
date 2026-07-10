import NetInfo, { NetInfoState } from '@react-native-community/netinfo'
import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

type BannerKind = 'offline' | 'poor' | 'back_online' | null

export default function NetworkBanner() {
  const [kind, setKind] = useState<BannerKind>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevConnected = useRef<boolean | null>(null)

  const show = (k: BannerKind, autoDismissMs?: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setKind(k)
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start()
    if (autoDismissMs) {
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setKind(null))
      }, autoDismissMs)
    }
  }

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      const connected  = state.isConnected ?? true
      const reachable  = state.isInternetReachable ?? true
      const effectiveType = (state as any).details?.cellularGeneration ?? ''

      if (!connected || !reachable) {
        prevConnected.current = false
        show('offline')
        return
      }

      // Detect poor signal on mobile data
      const isPoor = effectiveType === '2g' || effectiveType === null
      if (isPoor && connected) {
        show('poor', 4000)
        prevConnected.current = true
        return
      }

      // Was offline, now back online
      if (prevConnected.current === false) {
        show('back_online', 3000)
      } else if (kind === 'offline') {
        show('back_online', 3000)
      }
      prevConnected.current = true
    })
    return () => {
      unsub()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!kind) return null

  const config: Record<NonNullable<BannerKind>, { bg: string; text: string; label: string }> = {
    offline:     { bg: '#1F2937', text: '#F9FAFB', label: '⚠️  No Internet Connection' },
    poor:        { bg: '#92400E', text: '#FEF3C7', label: '📶  Poor Connection — Some features may be slow' },
    back_online: { bg: '#065F46', text: '#D1FAE5', label: '✅  Back Online' },
  }
  const c = config[kind]

  return (
    <Animated.View style={[styles.banner, { backgroundColor: c.bg, opacity }]}>
      <Text style={[styles.bannerText, { color: c.text }]}>{c.label}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  bannerText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    textAlign: 'center',
  },
})
