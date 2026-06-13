'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import Link from 'next/link'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  doctor: {
    specialty: string
    user: { full_name: string } | null
  } | null
}

interface Message {
  id: string
  sender_id: string
  content: string
  type: string
  created_at: string
}

export default function ChatConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token || !user) return
      const client = getAuthClient(token)

      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (userData) setMyUserId(userData.id)

      const { data: consult } = await supabase
        .from('consultations')
        .select('id, status, started_at, doctor:doctor_profiles(specialty, user:users(full_name))')
        .eq('id', id)
        .single()
      setConsultation(consult as unknown as Consultation)

      const { data: msgs } = await supabase
        .from('messages')
        .select('id, sender_id, content, type, created_at')
        .eq('consultation_id', id)
        .order('created_at', { ascending: true })
      setMessages((msgs ?? []) as Message[])
      setLoading(false)

      supabase
        .channel(`chat-${id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages',
          filter: `consultation_id=eq.${id}`,
        }, payload => {
          setMessages(prev => [...prev, payload.new as Message])
        })
        .subscribe()
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  async function sendMessage() {
    const text = input.trim()
    if (!text || !myUserId) return
    setInput('')
    const token = await getToken()
    if (!token) return
    const client = getAuthClient(token)
    await client.from('messages').insert({
      consultation_id: id,
      sender_id: myUserId,
      content: text,
      type: 'text',
    })
  }

  async function endConsultation() {
    setEnding(true)
    const token = await getToken()
    if (!token) { setEnding(false); return }
    const client = getAuthClient(token)
    await client.from('consultations').update({
      status: 'completed',
      ended_at: new Date().toISOString(),
    }).eq('id', id)
    router.push(`/patient/summary/${id}`)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading chat…</div>
      </div>
    )
  }

  const isReadOnly = consultation?.status === 'completed' || consultation?.status === 'cancelled'

  return (
    <div className="flex h-screen">
      {/* Left sidebar — doctor info */}
      <div className="w-64 border-r border-steel-grey bg-white flex flex-col p-5 gap-4 hidden lg:flex">
        <Link href="/patient" className="text-ink-black/50 text-sm hover:text-ink-black transition-colors">← Back</Link>
        <div className="card p-4 flex flex-col gap-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-xl">
            {consultation?.doctor?.user?.full_name?.charAt(0) ?? '?'}
          </div>
          <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {consultation?.doctor?.user?.full_name}</p>
          <p className="text-ink-black/50 text-xs">{consultation?.doctor?.specialty}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs text-success font-semibold">Active</span>
          </div>
        </div>
        {!isReadOnly && (
          <button
            onClick={endConsultation}
            disabled={ending}
            className="mt-auto btn-outline text-danger border-danger/30 hover:bg-danger/5 text-sm h-10 rounded-xl disabled:opacity-50"
          >
            {ending ? '…' : 'End Chat'}
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
              {consultation?.doctor?.user?.full_name?.charAt(0) ?? '?'}
            </div>
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">Dr. {consultation?.doctor?.user?.full_name}</p>
              <p className="text-xs text-success font-semibold">💬 Chat Consultation</p>
            </div>
          </div>
          {!isReadOnly && (
            <button onClick={endConsultation} disabled={ending}
              className="text-xs text-danger font-semibold px-3 py-1.5 rounded-lg border border-danger/20 hover:bg-danger/5 transition-colors disabled:opacity-50">
              End Chat
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
            const mine = m.sender_id === myUserId
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
                  mine
                    ? 'bg-int-blue text-white rounded-br-sm'
                    : 'bg-white text-ink-black rounded-bl-sm shadow-card'
                }`}>
                  {m.content}
                  <p className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-ink-black/40'}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })}
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
