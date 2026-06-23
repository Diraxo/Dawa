'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'
import type { Channel, FormatMessageResponse } from 'stream-chat'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  doctor: {
    specialty: string
    user: { full_name: string } | null
  } | null
}

export default function ChatConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken, userId: clerkUserId } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<FormatMessageResponse[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [ending, setEnding] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user || !clerkUserId) return
    let cancelled = false

    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        // Fetch consultation metadata from Supabase
        const { data: consult } = await supabase
          .from('consultations')
          .select('id, status, started_at, doctor:doctor_profiles(specialty, user:users(full_name))')
          .eq('id', id)
          .single()
        if (!cancelled) setConsultation(consult as unknown as Consultation)

        // Connect to Stream
        const streamClient = getStreamClient()
        if (!streamClient.userID) {
          const streamToken = await fetchStreamToken(token)
          await streamClient.connectUser(
            { id: clerkUserId!, name: user!.fullName ?? user!.firstName ?? 'Patient' },
            streamToken
          )
        }

        // The channel ID = the consultation ID (set when the channel was created from mobile/doctor)
        const ch = streamClient.channel('messaging', id)
        await ch.watch()

        if (cancelled) return

        setChannel(ch)
        setMessages(ch.state.messages)
      } catch (err) {
        console.error('[Chat] load error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id, user, clerkUserId])

  // Subscribe to real-time Stream messages
  useEffect(() => {
    if (!channel) return

    const unsub = channel.on('message.new', event => {
      if (event.message) {
        setMessages(prev => [...prev, event.message as FormatMessageResponse])
      }
    })

    return () => unsub.unsubscribe()
  }, [channel])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || !channel) return
    setInput('')
    await channel.sendMessage({ text })
  }

  async function leaveConsultation() {
    setEnding(true)
    try {
      // Patients leave — only the doctor can end and mark as completed
      router.push('/patient')
    } finally {
      setEnding(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Connecting to chat…</div>
      </div>
    )
  }

  const isReadOnly = consultation?.status === 'completed' || consultation?.status === 'cancelled'
  const doctorName = consultation?.doctor?.user?.full_name ?? ''

  return (
    <div className="flex h-screen">
      {/* Left sidebar — doctor info */}
      <div className="w-64 border-r border-steel-grey bg-white flex-col p-5 gap-4 hidden lg:flex">
        <Link href="/patient" className="text-ink-black/50 text-sm hover:text-ink-black transition-colors">← Back</Link>
        <div className="card p-4 flex flex-col gap-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-xl">
            {stripDrPrefix(doctorName).charAt(0) || '?'}
          </div>
          <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {stripDrPrefix(doctorName)}</p>
          <p className="text-ink-black/50 text-xs">{consultation?.doctor?.specialty}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={`w-2 h-2 rounded-full ${isReadOnly ? 'bg-steel-grey' : 'bg-success'}`} />
            <span className={`text-xs font-semibold ${isReadOnly ? 'text-ink-black/40' : 'text-success'}`}>
              {isReadOnly ? 'Ended' : 'Active'}
            </span>
          </div>
        </div>
        {!isReadOnly && (
          <button
            onClick={leaveConsultation}
            disabled={ending}
            className="mt-auto btn-outline text-ink-black/60 border-steel-grey text-sm h-10 rounded-xl disabled:opacity-50"
          >
            {ending ? '…' : 'Leave Chat'}
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-cloud-grey">
        {/* Header */}
        <div className="bg-white border-b border-steel-grey px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/patient" className="text-ink-black/50 text-sm hover:text-ink-black lg:hidden">←</Link>
            <div className="w-8 h-8 rounded-xl bg-gradient-hero flex items-center justify-center text-white font-bold text-sm">
              {stripDrPrefix(doctorName).charAt(0) || '?'}
            </div>
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {stripDrPrefix(doctorName)}</p>
              <p className="text-xs text-success font-semibold">💬 Chat Consultation</p>
            </div>
          </div>
          {!isReadOnly && (
            <button
              onClick={leaveConsultation}
              disabled={ending}
              className="text-xs text-ink-black/60 font-semibold px-3 py-1.5 rounded-lg border border-steel-grey hover:bg-cloud-grey transition-colors disabled:opacity-50"
            >
              {ending ? '…' : 'Leave Chat'}
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
          {messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <p className="text-3xl mb-2">💬</p>
                <p className="text-ink-black/40 text-sm">Start the conversation</p>
              </div>
            </div>
          )}
          {messages.map(m => {
            const mine = m.user?.id === clerkUserId
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
                  mine
                    ? 'bg-int-blue text-white rounded-br-sm'
                    : 'bg-white text-ink-black rounded-bl-sm shadow-card'
                }`}>
                  {m.text}
                  <p className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-ink-black/40'}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {!isReadOnly && (
          <div className="bg-white border-t border-steel-grey px-4 py-3 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
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
