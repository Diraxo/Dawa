'use client'

import { useEffect, useRef, useState } from 'react'

type BannerKind = 'offline' | 'poor' | 'back_online' | null

const BANNER_CONFIG: Record<NonNullable<BannerKind>, { bg: string; text: string; label: string }> = {
  offline:     { bg: 'bg-gray-900',  text: 'text-white',          label: '⚠️  No Internet Connection'                          },
  poor:        { bg: 'bg-amber-800', text: 'text-amber-100',      label: '📶  Poor Connection — Some features may be slow'      },
  back_online: { bg: 'bg-emerald-700', text: 'text-emerald-100',  label: '✅  Back Online'                                      },
}

export default function NetworkBanner() {
  const [kind, setKind] = useState<BannerKind>(null)
  const hideTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevOnline      = useRef<boolean | null>(null)

  const show = (k: BannerKind, autoDismissMs?: number) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    setKind(k)
    if (autoDismissMs) {
      hideTimerRef.current = setTimeout(() => setKind(null), autoDismissMs)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOffline = () => {
      prevOnline.current = false
      show('offline')
    }

    const handleOnline = () => {
      const wasOffline = prevOnline.current === false
      prevOnline.current = true
      if (wasOffline || kind === 'offline') {
        show('back_online', 3000)
      }
    }

    // Connection API — detect slow connections
    const connection = (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection
    const handleConnectionChange = () => {
      if (!navigator.onLine) return
      const type = connection?.effectiveType
      if (type === '2g' || type === 'slow-2g') {
        show('poor', 4000)
      }
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online',  handleOnline)
    connection?.addEventListener('change', handleConnectionChange)

    // Set initial state
    if (!navigator.onLine) {
      prevOnline.current = false
      setKind('offline')
    } else {
      prevOnline.current = true
    }

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online',  handleOnline)
      connection?.removeEventListener('change', handleConnectionChange)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!kind) return null

  const cfg = BANNER_CONFIG[kind]

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center py-2 px-4 text-sm font-montserrat font-semibold ${cfg.bg} ${cfg.text} transition-all`}>
      {cfg.label}
    </div>
  )
}
