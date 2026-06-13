'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'

interface AlertItem {
  id: string
  title: string
  body: string
}

const POLL_MS = 60_000

// Polls the notifications table for unread appointment alerts (created by the
// send-appointment-notification edge function: "starting soon" ~15 min before
// and "starting now" at the appointment time). Shows a browser notification
// plus an in-page toast, then marks them read.
export default function AppointmentAlerts() {
  const { user, isSignedIn } = useUser()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSignedIn || !user) return

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

    let cancelled = false

    async function poll() {
      try {
        if (!userIdRef.current) {
          const { data } = await supabase
            .from('users')
            .select('id')
            .eq('clerk_id', user!.id)
            .maybeSingle()
          if (!data) return
          userIdRef.current = data.id
        }

        const { data: rows } = await supabase
          .from('notifications')
          .select('id, title, body')
          .eq('user_id', userIdRef.current)
          .is('read_at', null)
          .in('type', ['appointment_reminder', 'appointment_start'])
          .order('created_at', { ascending: false })
          .limit(5)

        if (cancelled || !rows || rows.length === 0) return

        for (const n of rows) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(n.title, { body: n.body, icon: '/favicon.ico' })
            } catch {
              // Some mobile browsers require a service worker — toast still shows
            }
          }
        }
        setAlerts(prev => [...rows.filter(r => !prev.some(p => p.id === r.id)), ...prev].slice(0, 5))

        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .in('id', rows.map(r => r.id))
      } catch {
        // network hiccup — try again next poll
      }
    }

    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, user?.id])

  if (alerts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-sm">
      {alerts.map(a => (
        <div
          key={a.id}
          className="bg-white rounded-2xl shadow-xl border border-steel-grey p-4 flex items-start gap-3"
        >
          <span className="text-xl">⏰</span>
          <div className="flex-1 min-w-0">
            <p className="font-montserrat font-bold text-sm text-ink-black">{a.title}</p>
            <p className="text-ink-black/60 text-xs mt-0.5">{a.body}</p>
          </div>
          <button
            onClick={() => setAlerts(prev => prev.filter(p => p.id !== a.id))}
            className="text-ink-black/30 hover:text-ink-black text-sm"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
