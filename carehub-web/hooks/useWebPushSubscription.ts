'use client'

import { useEffect, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

// Registers the service worker and subscribes this browser to Web Push so
// the patient/doctor receives notifications even with the tab/browser fully
// closed — the mobile-equivalent of Expo/FCM/APNs push (see
// hooks/usePushNotifications.ts on mobile). Mounted once from AppointmentAlerts,
// which already gates on the user being signed in and having granted
// Notification permission.
export function useWebPushSubscription() {
  const { isSignedIn } = useUser()
  const ranRef = useRef(false)

  useEffect(() => {
    if (!isSignedIn || ranRef.current) return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

    ranRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          })
        }
        if (cancelled) return

        const json = subscription.toJSON()
        await fetch('/api/push-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        })
      } catch (err) {
        logger.error('[useWebPushSubscription] subscribe failed:', err)
      }
    })()

    return () => { cancelled = true }
  }, [isSignedIn])
}
