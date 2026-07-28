import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { consumeOAuthInFlight } from '@/lib/oauthResume'

// Checked once per cold start, before anything routes to /(auth)/splash —
// see lib/oauthResume.ts for why this distinction matters. The native OS
// splash (Theme.App.SplashScreen) is still showing throughout this check
// (SplashHider only hides it once ClerkLoaded resolves, well after this
// component mounts), so this adds no visible frame of its own either way.
export default function Index() {
  const [instant, setInstant] = useState<boolean | null>(null)

  useEffect(() => {
    consumeOAuthInFlight().then(setInstant)
  }, [])

  if (instant === null) return <View style={{ flex: 1, backgroundColor: '#070E27' }} />

  return (
    <Redirect href={{ pathname: '/(auth)/splash', params: instant ? { instant: '1' } : {} } as any} />
  )
}
