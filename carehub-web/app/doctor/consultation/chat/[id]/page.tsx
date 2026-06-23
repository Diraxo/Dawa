'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import type { Channel } from 'stream-chat'
import Link from 'next/link'

interface ChatMessage {
  id: string
  text: string
  userId: string
  createdAt: string
}

interface ConsultationInfo {
  id: string
  status: string
  patientClerkId: string
  patientName: string
}

function toMsg(raw: Record<string, unknown>): ChatMessage {
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    userId: String((raw.user as Record<string, unknown>)?.id ?? ''),
    createdAt: String(raw.created_at ?? ''),
  }
}

export default function DoctorChatConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<ConsultationInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [showEndSheet, setShowEndSheet] = useState(false)
  const channelRef = useRef<Channel | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!id || !user) return
    let mounted = true
    const consultationId = id as string

    async function init() {
      try {
        const clerkToken = await getToken()
        if (!clerkToken || !mounted || !user) return

        // Get consultation + patient's Clerk ID
        const { data: consult } = await supabase
          .from('consultations')
          .select('id, status, patient:users!patient_id(clerk_id, full_name)')
          .eq('id', consultationId)
          .single()

        if (!mounted) return

        const patientClerkId = (consult as unknown as { patient: { clerk_id: string; full_name: string } })?.patient?.clerk_id ?? ''
        const patientName = (consult as unknown as { patient: { clerk_id: string; full_name: string } })?.patient?.full_name ?? 'Patient'

        setConsultation({
          id: consultationId,
          status: (consult as unknown as { status: string })?.status ?? '',
          patientClerkId,
          patientName,
        })

        // Connect Stream user
        const streamToken = await fetchStreamToken(clerkToken)
        if (!mounted) return

        const client = getStreamClient()
        if (client.userID && client.userID !== user.id) {
          await client.disconnectUser()
        }
        if (!client.userID) {
          await client.connectUser(
            { id: user.id, name: user.fullName ?? user.firstName ?? 'Doctor' },
            streamToken
          )
        }

        // Watch the channel — creates it if it doesn't exist yet
        const members = [user.id, patientClerkId].filter(Boolean)
        const channel = client.channel('messaging', consultationId, { members })
        channelRef.current = channel

        const state = await channel.watch()
        if (!mounted) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setMessages((state.messages ?? []).map((m: any) => toMsg(m)))
        setLoading(false)

        channel.on('message.new', (event) => {
          if (!mounted || !event.message) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setMessages(prev => [...prev, toMsg(event.message as any)])
        })
      } catch (err) {
        logger.error('[Stream] Doctor chat init error:', err)
        if (mounted) setLoading(false)
      }
    }

    init()

    return () => {
      mounted = false
      channelRef.current?.stopWatching()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  async function sendMessage() {
    const text = input.trim()
    if (!text || !channelRef.current) return
    setInput('')
    await channelRef.current.sendMessage({ text })
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Connecting to chat…</div>
      </div>
    )
  }

  const patientName = consultation?.patientName ?? 'Patient'
  const isReadOnly = consultation?.status === 'completed' || consultation?.status === 'cancelled'

  return (
    <div className="flex h-screen">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id as string}
          patientName={patientName}
          onDone={() => router.replace('/doctor/consultations')}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Left sidebar */}
      <div className="w-64 border-r border-steel-grey bg-white flex flex-col p-5 gap-4 hidden lg:flex">
        <Link href="/doctor" className="text-ink-black/50 text-sm hover:text-ink-black transition-colors">← Back</Link>
        <div className="card p-4 flex flex-col gap-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-interactive flex items-center justify-center text-white font-black text-xl">
            {patientName.charAt(0)}
          </div>
          <p className="font-montserrat font-bold text-sm text-ink-black">{patientName}</p>
          <p className="text-ink-black/50 text-xs">Patient</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs text-success font-semibold">Live via Stream Chat</span>
          </div>
        </div>
        {!isReadOnly && (
          <button
            onClick={() => setShowEndSheet(true)}
            className="mt-auto btn-outline text-danger border-danger/30 hover:bg-danger/5 text-sm h-10 rounded-xl"
          >
            End Consultation
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-cloud-grey">
        {/* Header */}
        <div className="bg-white border-b border-steel-grey px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/doctor" className="text-ink-black/50 text-sm hover:text-ink-black lg:hidden">←</Link>
            <div className="w-8 h-8 rounded-xl bg-gradient-interactive flex items-center justify-center text-white font-bold text-sm">
              {patientName.charAt(0)}
            </div>
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">{patientName}</p>
              <p className="text-xs text-success font-semibold">💬 Chat Consultation</p>
            </div>
          </div>
          {!isReadOnly && (
            <button
              onClick={() => setShowEndSheet(true)}
              className="text-xs text-danger font-semibold px-3 py-1.5 rounded-lg border border-danger/20 hover:bg-danger/5 transition-colors"
            >
              End Consultation
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {isReadOnly && (
            <div className="text-center py-2">
              <span className="text-xs bg-steel-grey/50 rounded-full px-3 py-1 text-ink-black/50">
                Consultation ended — read only
              </span>
            </div>
          )}
          {messages.length === 0 && !isReadOnly && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <p className="text-3xl mb-2">💬</p>
                <p className="text-ink-black/40 text-sm">Consultation started — send the first message</p>
              </div>
            </div>
          )}
          {messages.map(m => {
            const mine = m.userId === user?.id
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
                  mine
                    ? 'bg-int-blue text-white rounded-br-sm'
                    : 'bg-white text-ink-black rounded-bl-sm shadow-card'
                }`}>
                  {m.text}
                  <p className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-ink-black/40'}`}>
                    {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {!isReadOnly && (
          <div className="bg-white border-t border-steel-grey px-4 py-3 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message…"
              className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-int-blue"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="btn-primary h-11 px-5 text-sm rounded-2xl disabled:opacity-40"
            >
              Send →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
