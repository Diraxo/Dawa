'use client'

import { useEffect, useState, useMemo } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'

interface Conversation {
  id: string
  patientName: string
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
  isActive: boolean
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 24 * 60 * 60 * 1000)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  if (diff < 7 * 24 * 60 * 60 * 1000)
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildConvos(channels: any[], userId: string): Conversation[] {
  return channels.map(ch => {
    const msgs = ch.state.messages
    const lastMsg = msgs[msgs.length - 1]
    const otherMember = Object.values(ch.state.members as Record<string, any>).find(
      (m: any) => m.user?.id !== userId
    )
    const d = ch.data as Record<string, unknown> | undefined
    const isActive = (d?.consultationStatus as string) !== 'completed'
    return {
      id: ch.id ?? '',
      patientName: (otherMember as any)?.user?.name ?? 'Patient',
      lastMessage: lastMsg?.text || (lastMsg ? '📎 Attachment' : 'No messages yet'),
      lastMessageTime: formatTime(lastMsg?.created_at),
      unreadCount: ch.countUnread(),
      isActive,
    }
  })
}

export default function DoctorMessagesPage() {
  const { user } = useUser()
  const { getToken, userId } = useAuth()
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!user || !userId) return
    let cancelled = false

    async function connect() {
      setLoading(true)
      try {
        const clerkToken = await getToken()
        if (!clerkToken) return
        const streamToken = await fetchStreamToken(clerkToken)
        const client = getStreamClient()

        if (!client.userID) {
          await client.connectUser(
            { id: userId!, name: user!.fullName ?? 'Doctor' },
            streamToken
          )
        }
        if (cancelled) return
        setConnected(true)

        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [userId!] } },
          { last_message_at: -1 },
          { watch: true, state: true, limit: 30 }
        )
        if (!cancelled) setConversations(buildConvos(channels, userId!))

        const sub = client.on('notification.message_new', async () => {
          if (cancelled) return
          const updated = await client.queryChannels(
            { type: 'messaging', members: { $in: [userId!] } },
            { last_message_at: -1 },
            { watch: false, state: true, limit: 30 }
          )
          if (!cancelled) setConversations(buildConvos(updated, userId!))
        })

        return () => sub.unsubscribe()
      } catch (err) {
        console.error('[DoctorMessages] Stream error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    let streamUnsub: (() => void) | null = null

    connect().then(cleanup => { streamUnsub = cleanup ?? null })

    return () => {
      cancelled = true
      streamUnsub?.()
    }
  }, [user, userId, getToken])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(c => c.patientName.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-montserrat font-black text-3xl text-ink-black">Messages</h1>
          <p className="text-ink-black/50 text-sm mt-1">Your patient conversations</p>
        </div>
        {totalUnread > 0 && (
          <div className="min-w-[32px] h-8 rounded-full bg-teal-green flex items-center justify-center px-2">
            <span className="text-white font-bold text-xs">{totalUnread > 99 ? '99+' : totalUnread}</span>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-black/30" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          placeholder="Search conversations…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full h-11 pl-11 pr-4 rounded-2xl border border-steel-grey bg-white font-montserrat text-sm text-ink-black placeholder:text-ink-black/30 focus:outline-none focus:border-int-blue transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-black/30 hover:text-ink-black/60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-[72px] shimmer-bg rounded-2xl" />)}
        </div>
      ) : !connected ? (
        <div className="card p-14 text-center">
          <p className="text-4xl mb-4">📡</p>
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">Not connected</p>
          <p className="text-ink-black/50 text-sm">Sign in to see your patient conversations.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <p className="text-4xl mb-4">💬</p>
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">
            {searchQuery ? 'No results found' : 'No conversations yet'}
          </p>
          <p className="text-ink-black/50 text-sm">
            {searchQuery
              ? `No conversations match "${searchQuery}"`
              : 'Patient conversations will appear here once you start consultations.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {filtered.map((conv, idx) => (
            <div key={conv.id}>
              <button
                onClick={() => router.push(`/doctor/consultation/chat/${conv.id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-cloud-grey transition-colors text-left"
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-lg"
                    style={{ background: conv.isActive ? '#1A4598' : '#9CA3AF' }}
                  >
                    {conv.patientName[0].toUpperCase()}
                  </div>
                  {conv.isActive && (
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-success border-2 border-white" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className={`font-montserrat text-sm text-ink-black truncate ${conv.unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>
                      {conv.patientName}
                    </p>
                    <p className="text-[11px] text-ink-black/40 flex-shrink-0 ml-3">{conv.lastMessageTime}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={`text-xs truncate flex-1 ${conv.unreadCount > 0 ? 'text-ink-black font-medium' : 'text-ink-black/50'}`}>
                      {conv.lastMessage}
                    </p>
                    {conv.unreadCount > 0 && (
                      <div className="min-w-[20px] h-5 rounded-full bg-teal-green flex items-center justify-center px-1.5 flex-shrink-0">
                        <span className="text-white font-bold text-[10px]">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
              {idx < filtered.length - 1 && <div className="h-px bg-cloud-grey ml-20" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
