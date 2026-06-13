'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface ChatThread {
  consultationId: string
  type: string
  status: string
  patientName: string
  lastMessage: string | null
  lastMessageAt: string | null
}

export default function DoctorMessagesPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { data: userData } = await client
        .from('users')
        .select('id')
        .eq('clerk_id', user!.id)
        .single()
      if (!userData) { setLoading(false); return }

      const { data: profile } = await client
        .from('doctor_profiles')
        .select('id')
        .eq('user_id', userData.id)
        .single()
      if (!profile) { setLoading(false); return }

      const { data: consultations } = await client
        .from('consultations')
        .select('id, type, status, created_at, patient:users!patient_id(full_name)')
        .eq('doctor_id', profile.id)
        .in('status', ['active', 'completed'])
        .order('created_at', { ascending: false })

      if (!consultations || consultations.length === 0) {
        setLoading(false)
        return
      }

      const threadData: ChatThread[] = await Promise.all(
        (consultations as unknown as Array<{
          id: string; type: string; status: string;
          patient: { full_name: string } | null
        }>).map(async (c) => {
          const { data: msgs } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('consultation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)

          const last = msgs?.[0] ?? null
          return {
            consultationId: c.id,
            type: c.type,
            status: c.status,
            patientName: c.patient?.full_name ?? 'Patient',
            lastMessage: last?.content ?? null,
            lastMessageAt: last?.created_at ?? null,
          }
        })
      )

      setThreads(threadData)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const typeIcon = (type: string) =>
    type === 'chat' ? '💬' : type === 'phone' ? '📞' : '🎥'

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Messages</h1>
        <p className="text-ink-black/50 text-sm mt-1">Your patient conversations</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 shimmer-bg rounded-3xl" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="card p-14 text-center">
          <p className="text-5xl mb-4">💬</p>
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No conversations yet</p>
          <p className="text-ink-black/50 text-sm">
            Conversations with patients will appear here once you accept consultations.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map(t => (
            <Link
              key={t.consultationId}
              href={t.type === 'chat' ? `/patient/consultation/chat/${t.consultationId}` : `/patient/summary/${t.consultationId}`}
              className="card card-hover p-4 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-gradient-interactive flex items-center justify-center text-white font-black text-lg flex-shrink-0">
                {t.patientName.charAt(0)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-montserrat font-bold text-sm text-ink-black">{t.patientName}</p>
                  <span className="text-xs">{typeIcon(t.type)}</span>
                </div>
                <p className="text-ink-black/50 text-xs truncate mt-0.5">
                  {t.lastMessage ?? 'No messages yet'}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                {t.lastMessageAt && (
                  <p className="text-[10px] text-ink-black/40">
                    {new Date(t.lastMessageAt).toLocaleDateString()}
                  </p>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  t.status === 'active'
                    ? 'bg-success/10 text-success'
                    : 'bg-steel-grey/60 text-ink-black/50'
                }`}>
                  {t.status === 'active' ? 'Active' : 'Ended'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
