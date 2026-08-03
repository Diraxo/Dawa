'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { isChannelReadThrough } from '@/lib/readCache'
import Link from 'next/link'
import { ConversationRow, ConversationDivider } from '@/components/chat/ConversationRow'
import { MessageCircle, Search } from 'lucide-react'

interface ChatThread {
  channelId: string
  doctorId: string
  doctorName: string
  doctorPhotoUrl: string | null
  lastMessage: string | null
  lastMessageAt: Date | null
  unreadCount: number
  isOnline: boolean
}

function attachmentPreview(attachments: any[] | undefined): string | null {
  if (!attachments?.length) return null
  const att = attachments[0]
  if (att.type === 'image') return 'Photo'
  if (att.type === 'audio' || att.mime_type?.includes('audio')) return 'Voice message'
  if (att.type === 'video') return 'Video'
  return 'File'
}

function formatMsgTime(date: Date | null): string {
  if (!date) return ''
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PatientMessagesPage() {
  const { user } = useUser()
  const { getToken, userId: clerkUserId } = useAuth()
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [matchingChannelIds, setMatchingChannelIds] = useState<Set<string>>(new Set())
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!user || !clerkUserId) return
    let cancelled = false

    const client = getStreamClient()

    async function load() {
      try {
        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [clerkUserId!] } },
          { last_message_at: -1 },
          { watch: true, state: true, presence: true, limit: 30 }
        )

        if (cancelled) return

        const threadData: ChatThread[] = channels.map(ch => {
          const msgs = ch.state.messages
          const lastMsg = msgs[msgs.length - 1]
          const otherMember = Object.values(ch.state.members).find(m => m.user?.id !== clerkUserId)
          const d = ch.data as Record<string, unknown> | undefined

          return {
            channelId: ch.id ?? '',
            doctorId: (d?.doctorId as string | undefined) ?? otherMember?.user?.id ?? '',
            doctorName: (d?.doctorName as string | undefined) ?? otherMember?.user?.name ?? 'Doctor',
            doctorPhotoUrl:
              (otherMember?.user?.image as string | undefined) ??
              (d?.doctorPhotoUrl as string | null | undefined) ??
              null,
            lastMessage: lastMsg?.text || attachmentPreview(lastMsg?.attachments) || null,
            lastMessageAt: lastMsg?.created_at ?? null,
            unreadCount: isChannelReadThrough(ch.id ?? '', lastMsg?.id) ? 0 : ch.countUnread(),
            isOnline: otherMember?.user?.online ?? false,
          }
        })

        setThreads(threadData)
      } catch (err) {
        console.error('[Messages] Stream error:', err)
        setError('Failed to load messages. Please refresh.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    async function connectAndLoad() {
      const clerkToken = await getToken()
      if (cancelled || !clerkToken) return
      if (!client.userID) {
        const streamToken = await fetchStreamToken(clerkToken)
        let ownPhotoUrl: string | null = null
        try {
          const { data: own } = await getAuthClient(clerkToken)
            .from('users')
            .select('profile_photo_url')
            .eq('clerk_id', clerkUserId!)
            .maybeSingle()
          ownPhotoUrl = (own as any)?.profile_photo_url ?? null
        } catch {}
        await client.connectUser(
          {
            id: clerkUserId!,
            name: user!.fullName ?? user!.firstName ?? 'Patient',
            image: ownPhotoUrl ?? user?.imageUrl ?? undefined,
          },
          streamToken
        )
      }
      if (!cancelled) await load()
    }

    connectAndLoad()

    // In-place update when a new message arrives in a watched channel
    const sub1 = client.on('message.new', event => {
      if (!event.message || !event.cid) return
      const channelId = event.cid.replace('messaging:', '')
      const msg = event.message
      setThreads(prev => {
        const idx = prev.findIndex(t => t.channelId === channelId)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          lastMessage: msg.text || attachmentPreview(msg.attachments) || 'Message',
          lastMessageAt: msg.created_at ? new Date(msg.created_at as string) : updated[idx].lastMessageAt,
          unreadCount: msg.user?.id === clerkUserId ? updated[idx].unreadCount : updated[idx].unreadCount + 1,
        }
        const [t] = updated.splice(idx, 1)
        return [t, ...updated]
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
      setThreads(prev =>
        prev.map(t => (t.doctorId === presenceUserId ? { ...t, isOnline: !!event.user?.online } : t))
      )
    })

    // Re-sync after a dropped socket resumes — a currently-open list stops
    // getting live events until this fires or the page is reloaded.
    const sub4 = client.on('connection.changed', event => {
      if (event.online && !cancelled) load()
    })

    // Live avatar update — e.g. the doctor changes their profile photo
    // while this list is open.
    const sub5 = client.on('user.updated', event => {
      const updatedUserId = event.user?.id
      if (!updatedUserId) return
      setThreads(prev =>
        prev.map(t => (t.doctorId === updatedUserId ? { ...t, doctorPhotoUrl: (event.user as any)?.image ?? null } : t))
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
  }, [user, clerkUserId])

  // Stream message content search (debounced 350ms, min 2 chars) — finds
  // conversations whose message history (not just the last message) matches,
  // so the single search bar covers both names and message content.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = search.trim()
    if (!q || q.length < 2 || !clerkUserId) {
      setMatchingChannelIds(new Set())
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const client = getStreamClient()
        const res = await client.search(
          { type: 'messaging', members: { $in: [clerkUserId!] } },
          q,
          { limit: 20, offset: 0 }
        )
        const ids = ((res.results ?? []) as any[])
          .map((r: any) => r.message?.channel_id as string | undefined)
          .filter((id): id is string => !!id)
        setMatchingChannelIds(new Set(ids))
      } catch {
        setMatchingChannelIds(new Set())
      }
    }, 350)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search, clerkUserId])

  const filteredThreads = threads.filter(t => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const nameMatch =
      t.doctorName.toLowerCase().includes(q) ||
      (t.lastMessage ?? '').toLowerCase().includes(q)
    return nameMatch || matchingChannelIds.has(t.channelId)
  })

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Messages</h1>
      </div>

      {/* Search */}
      {!loading && !error && threads.length > 0 && (
        <div className="relative mb-6">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-black/30"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
          />
        </div>
      )}

      {error ? (
        <div className="card p-8 text-center">
          <p className="text-danger text-sm">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-[72px] shimmer-bg rounded-2xl" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="card p-14 text-center">
          <MessageCircle size={44} className="mx-auto mb-4 text-steel-grey" />
          <p className="font-montserrat font-bold text-lg text-ink-black mb-2">No conversations yet</p>
          <p className="text-ink-black/50 text-sm mb-6">
            Start a chat consultation to message your doctor.
          </p>
          <Link href="/patient/doctors" className="btn-primary inline-flex h-10 px-6 text-sm rounded-xl">
            Find a Doctor →
          </Link>
        </div>
      ) : filteredThreads.length === 0 ? (
        <div className="card p-10 text-center">
          <Search size={30} className="mx-auto mb-3 text-steel-grey" />
          <p className="font-montserrat font-bold text-ink-black mb-1">No matches</p>
          <p className="text-ink-black/50 text-sm">Try a different name or filter.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {filteredThreads.map((t, idx) => (
            <div key={t.channelId}>
              <ConversationRow
                href={`/patient/consultation/chat/${t.channelId}`}
                data={{
                  id: t.channelId,
                  peerName: t.doctorName,
                  peerPhotoUrl: t.doctorPhotoUrl,
                  isDoctorPeer: true,
                  lastMessage: t.lastMessage ?? 'No messages yet — tap to open',
                  lastMessageTime: t.lastMessageAt ? formatMsgTime(t.lastMessageAt) : '',
                  unreadCount: t.unreadCount,
                  isOnline: t.isOnline,
                }}
              />
              {idx < filteredThreads.length - 1 && <ConversationDivider />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
