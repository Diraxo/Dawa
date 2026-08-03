'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { CheckCircle2, XCircle, Ban } from 'lucide-react'

// Shared, cross-platform "has the doctor seen this status change yet" gate.
// doctor_profiles.status_ack (migration 057) is a single DB column read AND
// written by both mobile (app/(doctor)/(tabs)/_layout.tsx) and this
// component — whichever platform the doctor opens first shows the canonical
// popup for their current status and flips status_ack to true; the other
// platform then sees status_ack already true and stays silent. Any admin
// status change resets status_ack to false (see the trigger in migration
// 057), so this covers approved, rejected, suspended, and reinstate (back to
// approved) transitions alike — not just the original "approved" case.

type NoticeStatus = 'approved' | 'rejected' | 'suspended'

const COPY: Record<NoticeStatus, { title: string; body: string; Icon: typeof CheckCircle2; color: string }> = {
  approved: {
    title: 'Doctor Application Approved',
    body: 'Your account has been approved. You may now begin accepting patients.',
    Icon: CheckCircle2,
    color: 'text-success',
  },
  rejected: {
    title: 'Doctor Application Rejected',
    body: 'Your application was not approved.',
    Icon: XCircle,
    color: 'text-danger',
  },
  suspended: {
    title: 'Account Suspended',
    body: 'Your account has been suspended. Please contact support.',
    Icon: Ban,
    color: 'text-danger',
  },
}

export default function StatusAckNotice() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [notice, setNotice] = useState<NoticeStatus | null>(null)
  const profileIdRef = useRef<string | null>(null)
  const ackInFlightRef = useRef(false)

  const ack = async (profileId: string) => {
    if (ackInFlightRef.current) return
    ackInFlightRef.current = true
    try {
      const token = await getToken()
      if (token) {
        await getAuthClient(token).from('doctor_profiles').update({ status_ack: true } as any).eq('id', profileId)
      }
    } catch {
      // best-effort — worst case the notice re-shows next mount
    } finally {
      ackInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const token = await getToken()
      if (!token || cancelled) return
      const client = getAuthClient(token)

      const { data: userRow } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!userRow || cancelled) return

      const { data: dp } = await client
        .from('doctor_profiles')
        .select('id, status, status_ack')
        .eq('user_id', (userRow as any).id)
        .single()
      if (!dp || cancelled) return

      profileIdRef.current = (dp as any).id

      const status = (dp as any).status as string
      if (!(dp as any).status_ack && (status === 'approved' || status === 'rejected' || status === 'suspended')) {
        setNotice(status as NoticeStatus)
        ack((dp as any).id)
      }

      channel = supabase
        .channel(`doctor-status-ack-${(dp as any).id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${(dp as any).id}` },
          (payload) => {
            const next = payload.new as { status?: string; status_ack?: boolean }
            if (
              next?.status_ack === false &&
              (next.status === 'approved' || next.status === 'rejected' || next.status === 'suspended')
            ) {
              setNotice(next.status as NoticeStatus)
              if (profileIdRef.current) ack(profileIdRef.current)
            }
          }
        )
        .subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!notice) return null

  const { title, body, Icon, color } = COPY[notice]

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
        <Icon size={40} className={`mx-auto mb-3 ${color}`} />
        <p className="font-montserrat font-black text-lg text-ink-black mb-2">{title}</p>
        <p className="text-ink-black/60 text-sm leading-relaxed mb-5">{body}</p>
        <button
          onClick={() => setNotice(null)}
          className="w-full h-11 rounded-xl font-montserrat font-bold text-sm text-white"
          style={{ background: 'linear-gradient(to right, #2962FF, #00BFA5)' }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
