import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { supabase } from '@/lib/supabase'

type VersionStatus = 'loading' | 'ok' | 'update_required'

interface VersionCheckResult {
  status: VersionStatus
  updateMessage: string
  storeUrl: string
  latestVersion: string
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function useVersionCheck(): VersionCheckResult {
  const [status, setStatus] = useState<VersionStatus>('loading')
  const [updateMessage, setUpdateMessage] = useState('')
  const [storeUrl, setStoreUrl] = useState('')
  const [latestVersion, setLatestVersion] = useState('')

  useEffect(() => {
    const platform = Platform.OS === 'ios' ? 'ios' : 'android'
    const currentVersion = Constants.expoConfig?.version ?? '0.0.0'

    supabase
      .from('app_config')
      .select('min_required_version, latest_version, update_message, store_url')
      .eq('platform', platform)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          // On error, allow the user through — don't block on network failure
          setStatus('ok')
          return
        }

        setUpdateMessage(data.update_message)
        setStoreUrl(data.store_url)
        setLatestVersion(data.latest_version)

        if (compareSemver(currentVersion, data.min_required_version) < 0) {
          setStatus('update_required')
        } else {
          setStatus('ok')
        }
      })
  }, [])

  return { status, updateMessage, storeUrl, latestVersion }
}
