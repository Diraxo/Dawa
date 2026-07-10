'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Bell, CheckCircle2, XCircle, ClipboardList, FileEdit, Star, Clock, Building2 } from 'lucide-react'

interface NotificationRow {
  id: string
  title: string
  body: string
  type: string
  data_json: Record<string, string> | null
}

const POLL_MS = 30_000

const TYPE_ICONS: Record<string, typeof Bell> = {
  new_request: Bell,
  accepted: CheckCircle2,
  declined: XCircle,
  summary_ready: ClipboardList,
  summary_updated: FileEdit,
  review_received: Star,
  appointment_reminder: Clock,
  appointment_start: Building2,
}

function resolveUrl(n: NotificationRow, role: string): string {
  const data = n.data_json ?? {}
  const screen = (data.screen ?? '') as string
  const consultationId = (data.consultationId ?? '') as string
  const consultationType = (data.consultationType ?? 'chat') as string

  if (role === 'doctor') {
    switch (screen) {
      case 'incoming_request': return '/doctor/consultations'
      case 'consultations':   return '/doctor/consultations'
      case 'profile':         return '/doctor/profile'
      default:
        return consultationId ? '/doctor/schedule' : '/doctor/home'
    }
  }

  // Patient
  switch (screen) {
    case 'consultation':
      return consultationId
        ? `/patient/consultation/${consultationType}/${consultationId}`
        : '/patient/appointments'
    case 'consultation_summary':
      return consultationId ? `/patient/summary/${consultationId}` : '/patient/appointments'
    case 'profile':
      return '/patient/profile'
    default:
      return '/patient/appointments'
  }
}

export default function AppointmentAlerts() {
  const { user, isSignedIn } = useUser()
  const router = useRouter()
  const pathname = usePathname()
  const [alerts, setAlerts] = useState<NotificationRow[]>([])
  const userIdRef = useRef<string | null>(null)
  const userRoleRef = useRef<string>('patient')
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
    // Dismiss any alert whose target is the current page
    setAlerts(prev => prev.filter(a => !pathname.startsWith(resolveUrl(a, userRoleRef.current))))
  }, [pathname])

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
            .select('id, role')
            .eq('clerk_id', user!.id)
            .maybeSingle()
          if (!data) return
          userIdRef.current = data.id
          userRoleRef.current = (data as any).role ?? 'patient'
        }

        const { data: rows } = await supabase
          .from('notifications')
          .select('id, title, body, type, data_json')
          .eq('user_id', userIdRef.current)
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(5)

        if (cancelled || !rows || rows.length === 0) return

        for (const n of rows) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              const doctorPhotoUrl = ((n.data_json as Record<string, string> | null) ?? {}).doctorPhotoUrl
              const browserNotif = new Notification(n.title, { body: n.body, icon: doctorPhotoUrl || '/favicon.ico' })
              const targetUrl = resolveUrl(n as NotificationRow, userRoleRef.current)
              browserNotif.onclick = () => {
                window.focus()
                router.push(targetUrl)
                browserNotif.close()
              }
            } catch {
              // Some browsers require a service worker — in-page toast still shows
            }
          }
        }

        setAlerts(prev =>
          [...(rows as NotificationRow[]).filter(r => {
            if (prev.some(p => p.id === r.id)) return false
            // Suppress if the patient is already on the target page
            const url = resolveUrl(r, userRoleRef.current)
            if (pathnameRef.current.startsWith(url)) return false
            return true
          }), ...prev].slice(0, 5)
        )

        // Auto-dismiss any existing alerts whose target matches the current page
        setAlerts(prev => prev.filter(a => !pathnameRef.current.startsWith(resolveUrl(a, userRoleRef.current))))

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
      {alerts.map(a => {
        const AlertIcon = TYPE_ICONS[a.type] ?? Bell
        const url = resolveUrl(a, userRoleRef.current)
        return (
          <div
            key={a.id}
            onClick={() => {
              setAlerts(prev => prev.filter(p => p.id !== a.id))
              router.push(url)
            }}
            className="bg-white rounded-2xl shadow-xl border border-steel-grey p-4 flex items-start gap-3 cursor-pointer hover:shadow-2xl transition-shadow"
          >
            <AlertIcon size={20} className="flex-shrink-0 text-int-blue" />
            <div className="flex-1 min-w-0">
              <p className="font-montserrat font-bold text-sm text-ink-black">{a.title}</p>
              <p className="text-ink-black/60 text-xs mt-0.5 leading-relaxed">{a.body}</p>
              <p className="text-int-blue text-xs mt-1 font-semibold">Tap to open →</p>
            </div>
            <button
              onClick={e => {
                e.stopPropagation()
                setAlerts(prev => prev.filter(p => p.id !== a.id))
              }}
              className="text-ink-black/30 hover:text-ink-black text-sm flex-shrink-0 mt-0.5"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
