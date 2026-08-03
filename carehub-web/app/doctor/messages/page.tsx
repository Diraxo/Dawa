'use client'

import { useEffect, useState, useMemo } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { getAuthClient } from '@/lib/supabase'
import { isChannelReadThrough } from '@/lib/readCache'
import { ConversationRow, ConversationDivider } from '@/components/chat/ConversationRow'
import { WifiOff, MessageCircle } from 'lucide-react'

interface Conversation {
  id: string
  patientId: string
  patientName: string
  patientPhotoUrl: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
  isOnline: boolean
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

function attachmentPreview(attachments: any[] | undefined): string | null {
  if (!attachments?.length) return null
  const att = attachments[0]
  if (att.type === 'image') return 'Photo'
  if (att.type === 'audio' || att.mime_type?.includes('audio')) return 'Voice message'
  if (att.type === 'video') return 'Video'
  return 'File'
}

function buildConvos(channels: any[], userId: string): Conversation[] {
  return channels.map(ch => {
    const msgs = ch.state.messages
    const lastMsg = msgs[msgs.length - 1]
    const otherMember = Object.values(ch.state.members as Record<string, any>).find(
      (m: any) => m.user?.id !== userId
    )
    return {
      id: ch.id ?? '',
      patientId: (otherMember as any)?.user?.id ?? '',
      patientName: (otherMember as any)?.user?.name ?? 'Patient',
      patientPhotoUrl: (otherMember as any)?.user?.image ?? null,
      lastMessage: lastMsg?.text || attachmentPreview(lastMsg?.attachments) || 'No messages yet',
      lastMessageTime: formatTime(lastMsg?.created_at),
      unreadCount: isChannelReadThrough(ch.id, lastMsg?.id) ? 0 : ch.countUnread(),
      isOnline: (otherMember as any)?.user?.online ?? false,
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
    const client = getStreamClient()

    async function load() {
      const channels = await client.queryChannels(
        { type: 'messaging', members: { $in: [userId!] } },
        { last_message_at: -1 },
        { watch: true, state: true, presence: true, limit: 30 }
      )
      if (!cancelled) setConversations(buildConvos(channels, userId!))
    }

    async function connectAndLoad() {
      setLoading(true)
      try {
        const clerkToken = await getToken()
        if (cancelled || !clerkToken) return
        if (!client.userID) {
          const streamToken = await fetchStreamToken(clerkToken)
          let ownPhotoUrl: string | null = null
          try {
            const { data: own } = await getAuthClient(clerkToken)
              .from('users')
              .select('profile_photo_url')
              .eq('clerk_id', userId!)
              .maybeSingle()
            ownPhotoUrl = (own as any)?.profile_photo_url ?? null
          } catch {}
          await client.connectUser(
            { id: userId!, name: user!.fullName ?? 'Doctor', image: ownPhotoUrl ?? user?.imageUrl ?? undefined },
            streamToken
          )
        }
        if (cancelled) return
        setConnected(true)
        await load()
      } catch (err) {
        console.error('[DoctorMessages] Stream error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    connectAndLoad()

    // In-place update when a new message arrives in a watched channel
    const sub1 = client.on('message.new', event => {
      if (!event.message || !event.cid) return
      const channelId = event.cid.replace('messaging:', '')
      const msg = event.message
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === channelId)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          lastMessage: msg.text || attachmentPreview(msg.attachments) || 'Message',
          lastMessageTime: formatTime(msg.created_at),
          unreadCount: msg.user?.id === userId ? updated[idx].unreadCount : updated[idx].unreadCount + 1,
        }
        const [conv] = updated.splice(idx, 1)
        return [conv, ...updated]
      })
    })

    // Full refetch when a message arrives in a channel not yet being watched
    const sub2 = client.on('notification.message_new', () => {
      if (!cancelled) load()
    })

    // Live online/offline dot — requires `presence: true` above to be populated.
    const sub3 = client.on('user.presence.changed', event => {
      const presenceUserId = event.user?.id
      if (!presenceUserId) return
      setConversations(prev =>
        prev.map(c => (c.patientId === presenceUserId ? { ...c, isOnline: !!event.user?.online } : c))
      )
    })

    // Re-sync after a dropped socket resumes.
    const sub4 = client.on('connection.changed', event => {
      if (event.online && !cancelled) load()
    })

    // Live avatar update — e.g. the patient changes their profile photo
    // while this list is open.
    const sub5 = client.on('user.updated', event => {
      const updatedUserId = event.user?.id
      if (!updatedUserId) return
      setConversations(prev =>
        prev.map(c => (c.patientId === updatedUserId ? { ...c, patientPhotoUrl: (event.user as any)?.image ?? null } : c))
      )
    })

    return () => {
      cancelled = true
      sub1.unsubscribe()
      sub2.unsubscribe()
      sub3.unsubscribe()
      sub4.unsubscribe()
      sub5.unsubscribe()
    }
  }, [user, userId, getToken])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      c =>
        c.patientName.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
    )
  }, [conversations, searchQuery])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  )

  function openChat(conv: Conversation) {
    router.push(`/doctor/consultation/chat/${conv.id}`)
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Messages</h1>
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
          <WifiOff size={36} className="mx-auto mb-4 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">Not connected</p>
          <p className="text-ink-black/50 text-sm">Sign in to see your patient conversations.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-14 text-center">
          <MessageCircle size={36} className="mx-auto mb-4 text-steel-grey" />
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
              <ConversationRow
                onClick={() => openChat(conv)}
                data={{
                  id: conv.id,
                  peerName: conv.patientName,
                  peerPhotoUrl: conv.patientPhotoUrl,
                  isDoctorPeer: false,
                  lastMessage: conv.lastMessage,
                  lastMessageTime: conv.lastMessageTime,
                  unreadCount: conv.unreadCount,
                  isOnline: conv.isOnline,
                }}
              />
              {idx < filtered.length - 1 && <ConversationDivider />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
