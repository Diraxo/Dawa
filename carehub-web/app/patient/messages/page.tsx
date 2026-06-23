'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'

interface ChatThread {
  channelId: string
  doctorName: string
  doctorPhotoUrl: string | null
  lastMessage: string | null
  lastMessageAt: Date | null
  unreadCount: number
  consultationStatus: 'active' | 'completed'
  consultationType: string
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all')

  useEffect(() => {
    if (!user || !clerkUserId) return
    let cancelled = false

    async function load() {
      try {
        const clerkToken = await getToken()
        if (!clerkToken) return

        const client = getStreamClient()

        if (!client.userID) {
          const streamToken = await fetchStreamToken(clerkToken)
          await client.connectUser(
            { id: clerkUserId!, name: user!.fullName ?? user!.firstName ?? 'Patient' },
            streamToken
          )
        }

        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [clerkUserId!] } },
          { last_message_at: -1 },
          { watch: true, state: true, limit: 30 }
        )

        if (cancelled) return

        const threadData: ChatThread[] = channels.map(ch => {
          const msgs = ch.state.messages
          const lastMsg = msgs[msgs.length - 1]
          const otherMember = Object.values(ch.state.members).find(m => m.user?.id !== clerkUserId)
          const d = ch.data as Record<string, unknown> | undefined

          return {
            channelId: ch.id ?? '',
            doctorName: (d?.doctorName as string | undefined) ?? otherMember?.user?.name ?? 'Doctor',
            doctorPhotoUrl: (d?.doctorPhotoUrl as string | null | undefined) ?? null,
            lastMessage: lastMsg?.text ?? null,
            lastMessageAt: lastMsg?.created_at ? new Date(lastMsg.created_at as string) : null,
            unreadCount: ch.countUnread(),
            consultationStatus: (d?.consultationStatus as string) === 'completed' ? 'completed' : 'active',
            consultationType: (d?.consultationType as string | undefined) ?? 'chat',
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

    load()

    // Real-time: refresh list when a new message arrives
    const client = getStreamClient()
    const sub = client.on('notification.message_new', () => {
      if (!cancelled) load()
    })

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [user, clerkUserId])

  const typeIcon = (type: string) =>
    type === 'chat' ? '💬' : type === 'phone' ? '📞' : '🎥'

  const filteredThreads = threads.filter(t => {
    const nameMatch = !search || t.doctorName.toLowerCase().includes(search.toLowerCase())
    const statusMatch = statusFilter === 'all' || t.consultationStatus === statusFilter
    return nameMatch && statusMatch
  })

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Messages</h1>
        <p className="text-ink-black/50 text-sm mt-1">Your consultation conversations</p>
      </div>

      {/* Search + filter */}
      {!loading && !error && threads.length > 0 && (
        <div className="flex flex-col gap-3 mb-6">
          <div className="relative">
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
              placeholder="Search by doctor name…"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-sm focus:outline-none focus:border-int-blue"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'completed'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="px-4 py-1.5 rounded-full font-montserrat font-semibold text-xs transition-all capitalize"
                style={statusFilter === s
                  ? { background: 'linear-gradient(to right, #2962FF, #00BFA5)', color: '#fff' }
                  : { background: '#F5F7FA', color: '#6B7280' }
                }
              >
                {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Ended'}
              </button>
            ))}
          </div>
        </div>
      )}

      {error ? (
        <div className="card p-8 text-center">
          <p className="text-danger text-sm">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 shimmer-bg rounded-3xl" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="card p-14 text-center">
          <p className="text-5xl mb-4">💬</p>
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
          <p className="text-3xl mb-3">🔍</p>
          <p className="font-montserrat font-bold text-ink-black mb-1">No matches</p>
          <p className="text-ink-black/50 text-sm">Try a different name or filter.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredThreads.map(t => (
            <Link
              key={t.channelId}
              href={`/patient/consultation/chat/${t.channelId}`}
              className="card card-hover p-4 flex items-center gap-4"
            >
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                {t.doctorPhotoUrl ? (
                  <img src={t.doctorPhotoUrl} alt={t.doctorName} className="w-12 h-12 rounded-2xl object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg">
                    {stripDrPrefix(t.doctorName).charAt(0)}
                  </div>
                )}
                {t.unreadCount > 0 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-teal-green flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">{t.unreadCount}</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-montserrat font-bold text-sm text-ink-black">
                    Dr. {stripDrPrefix(t.doctorName)}
                  </p>
                  <span className="text-xs">{typeIcon(t.consultationType)}</span>
                </div>
                <p className="text-ink-black/50 text-xs truncate mt-0.5">
                  {t.lastMessage ?? 'No messages yet — tap to open'}
                </p>
              </div>

              {/* Meta */}
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                {t.lastMessageAt && (
                  <p className="text-[10px] text-ink-black/40">
                    {formatMsgTime(t.lastMessageAt)}
                  </p>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  t.consultationStatus === 'active'
                    ? 'bg-success/10 text-success'
                    : 'bg-steel-grey/60 text-ink-black/50'
                }`}>
                  {t.consultationStatus === 'active' ? 'Active' : 'Ended'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
