'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import { getStreamClient, fetchStreamToken, preloadImages, getMessageImageUrls, onStreamReconnect } from '@/lib/stream'
import { markChannelReadLocally } from '@/lib/readCache'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import { WebVoiceNotePlayer } from '@/components/ui/WebVoiceNotePlayer'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { Channel, FormatMessageResponse } from 'stream-chat'
import { Image as ImageIcon, Mic, Paperclip, MessageCircle, ClipboardList } from 'lucide-react'

// ── ConsultationChatThread ───────────────────────────────────────────────────
// The single chat implementation shared by the standalone chat page AND the
// in-call chat drawer (phone/video). There must only ever be one chat UI —
// duplicating this into a second, simplified component causes behavior drift
// (e.g. attachments auto-sending in one place but not the other).
//
// variant='page'   → full-height page with back button + messages/summary link
// variant='drawer' → compact panel for the in-call sidebar (close button,
//                     no page navigation, no duplicate heartbeat)

type Role = 'patient' | 'doctor'

interface ConsultationInfo {
  id: string
  status: string
  peerClerkId: string
  peerName: string
  peerSpecialty?: string
  peerPatientId?: string
  peerPhotoUrl?: string | null
}

interface PeerProfile {
  full_name?: string
  gender?: string | null
  country?: string | null
  specialty?: string
  years_experience?: number | null
  hospital_name?: string | null
  bio?: string | null
  languages?: string[] | null
}

type Att = {
  type?: string
  image_url?: string
  asset_url?: string
  file?: string
  mime_type?: string
  duration?: number
  title?: string
  fallback?: string
}

function getAtts(m: FormatMessageResponse): Att[] {
  return (m.attachments as Att[] | undefined) ?? []
}

function formatDateSeparator(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (d.getTime() === today.getTime()) return 'Today'
  if (d.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

const REPORT_REASONS = [
  'Inappropriate Language',
  'Unprofessional Conduct',
  'Technical / Data Issue',
  'Other',
]

// ── SVG Icons ──────────────────────────────────────────────────────────────────
const IconUser = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconSearch = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="11" cy="11" r="8" strokeLinecap="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
  </svg>
)
const IconTrash = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <polyline strokeLinecap="round" strokeLinejoin="round" points="3 6 5 6 21 6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v6M14 11v6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
)
const IconFlag = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" strokeLinecap="round" />
  </svg>
)
const IconBan = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="12" r="10" strokeLinecap="round" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" strokeLinecap="round" />
  </svg>
)
const IconAttach = () => (
  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
)
const IconImage = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
  </svg>
)
const IconDocument = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)
const IconSend = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <line x1="22" y1="2" x2="11" y2="13" strokeLinecap="round" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)
const IconReply = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
)
const IconCopy = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinecap="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)
const IconDelete = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <polyline strokeLinecap="round" strokeLinejoin="round" points="3 6 5 6 21 6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
)
const IconFlagSm = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" strokeLinecap="round" />
  </svg>
)
const IconLock = () => (
  <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeLinecap="round" />
    <path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
)
const IconClose = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export interface ConsultationChatThreadProps {
  consultationId: string
  role: Role
  variant?: 'page' | 'drawer'
  /** Drawer variant: called when the user taps the close (X) button. */
  onClose?: () => void
  /** Show the doctor-only "End" quick action in the header (default: page + doctor). */
  showEndButton?: boolean
  /** Drawer variant: whether the drawer is actually visible on screen right now
   *  (it stays mounted after first open so scroll position survives closing).
   *  Controls whether incoming messages are marked read or counted as unread. */
  isVisible?: boolean
  /** Drawer variant: called for each message that arrives while isVisible is false,
   *  or once on load with the channel's real unread count if the drawer starts closed. */
  onUnreadMessage?: (count?: number) => void
}

export function ConsultationChatThread({
  consultationId,
  role,
  variant = 'page',
  onClose,
  showEndButton,
  isVisible = true,
  onUnreadMessage,
}: ConsultationChatThreadProps) {
  const id = consultationId
  const router = useRouter()
  const { getToken, userId: clerkUserId } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<ConsultationInfo | null>(null)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<FormatMessageResponse[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [peerTyping, setPeerTyping] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)
  const [showEndSheet, setShowEndSheet] = useState(false)

  const [peerReadAt, setPeerReadAt] = useState<Date | null>(null)
  const peerClerkIdRef = useRef<string>('')
  const [peerOnline, setPeerOnline] = useState(false)

  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; preview: string }>>([])
  const [imageViewer, setImageViewer] = useState<{ images: string[]; index: number; message: FormatMessageResponse } | null>(null)
  const [showImageMenu, setShowImageMenu] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const isSendingRef = useRef(false)
  const messageRefs = useRef<Record<string, HTMLDivElement>>({})
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

  const [replyTo, setReplyTo] = useState<FormatMessageResponse | null>(null)
  const [contextMenu, setContextMenu] = useState<{ message: FormatMessageResponse; x: number; y: number } | null>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  const [showProfile, setShowProfile] = useState(false)
  const [peerProfile, setPeerProfile] = useState<PeerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetail, setReportDetail] = useState('')
  const [reportSubmitted, setReportSubmitted] = useState(false)

  const [showBlockModal, setShowBlockModal] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<Channel | null>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const isPage = variant === 'page'
  const isDoctor = role === 'doctor'
  const resolvedShowEndButton = showEndButton ?? (isPage && isDoctor)

  // Refs so the message.new subscription doesn't need to re-subscribe every
  // time the drawer's open/closed state or callback identity changes.
  const isVisibleRef = useRef(isVisible)
  useEffect(() => { isVisibleRef.current = isVisible }, [isVisible])
  const onUnreadMessageRef = useRef(onUnreadMessage)
  useEffect(() => { onUnreadMessageRef.current = onUnreadMessage }, [onUnreadMessage])
  // Read by listeners set up in effects that don't re-run on every status
  // change (the message.new subscription only re-subscribes when `channel`
  // changes) — a completed consultation must stop generating read receipts
  // even inside an already-open, already-subscribed chat. Declared here as a
  // ref; kept in sync by an effect below `isReadOnly`'s declaration.
  const isReadOnlyRef = useRef(false)

  // Drawer becoming visible clears anything that arrived while it was hidden.
  useEffect(() => {
    if (isVisible && channel && !isReadOnlyRef.current) {
      markChannelReadLocally(id, messages[messages.length - 1]?.id)
      channel.markRead().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, channel])

  // Only the page instance owns the heartbeat — the in-call drawer reuses the
  // same consultation the call screen already keeps alive, so a second
  // interval here would double-write last_heartbeat_at.
  useHeartbeat(id, isPage && !loading)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      setContextMenu(null)
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false)
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setShowAttachMenu(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    if (!imageViewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setImageViewer(null); setShowImageMenu(false) }
      if (e.key === 'ArrowLeft') setImageViewer(prev => prev ? { ...prev, index: Math.max(0, prev.index - 1) } : null)
      if (e.key === 'ArrowRight') setImageViewer(prev => prev ? { ...prev, index: Math.min(prev.images.length - 1, prev.index + 1) } : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imageViewer])

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`${role}-chat-status-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${id}` }, (payload) => {
        const s = (payload.new as { status: string })?.status
        if (s === 'completed' || s === 'ended_abnormally' || s === 'cancelled') {
          setConsultation(prev => prev ? { ...prev, status: s } : prev)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, role])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!user || !clerkUserId) return
    let cancelled = false

    async function load() {
      try {
        const token = await getToken()
        if (!token) return

        let peerClerkId = ''
        let peerName = 'User'
        let peerSpecialty: string | undefined
        let peerPatientId: string | undefined
        let peerPhotoUrl: string | null = null
        let status = ''

        if (role === 'patient') {
          const { data: consult } = await supabase
            .from('consultations')
            .select('id, status, doctor:doctor_profiles(specialty, user:users(full_name, clerk_id, profile_photo_url))')
            .eq('id', id)
            .single()
          const doctor = (consult as any)?.doctor
          status = (consult as any)?.status ?? ''
          peerClerkId = doctor?.user?.clerk_id ?? ''
          peerName = doctor?.user?.full_name ?? 'Doctor'
          peerSpecialty = doctor?.specialty
          peerPhotoUrl = doctor?.user?.profile_photo_url ?? null
        } else {
          const { data: consult } = await supabase
            .from('consultations')
            .select('id, status, patient_id, patient:users!patient_id(clerk_id, full_name, profile_photo_url)')
            .eq('id', id)
            .single()
          const patient = (consult as any)?.patient
          status = (consult as any)?.status ?? ''
          peerClerkId = patient?.clerk_id ?? ''
          peerName = patient?.full_name ?? 'Patient'
          peerPatientId = (consult as any)?.patient_id ?? undefined
          peerPhotoUrl = patient?.profile_photo_url ?? null
        }

        if (cancelled) return
        setConsultation({ id, status, peerClerkId, peerName, peerSpecialty, peerPatientId, peerPhotoUrl })
        peerClerkIdRef.current = peerClerkId

        const streamClient = getStreamClient()
        if (!streamClient.userID) {
          const streamToken = await fetchStreamToken(token)
          let ownPhotoUrl: string | null = null
          try {
            const { data: own } = await getAuthClient(token)
              .from('users')
              .select('profile_photo_url')
              .eq('clerk_id', clerkUserId!)
              .maybeSingle()
            ownPhotoUrl = (own as any)?.profile_photo_url ?? null
          } catch {}
          await streamClient.connectUser(
            {
              id: clerkUserId!,
              name: user!.fullName ?? user!.firstName ?? (isDoctor ? 'Doctor' : 'Patient'),
              image: ownPhotoUrl ?? user?.imageUrl ?? undefined,
            },
            streamToken
          )
        }

        // Pass members so watch() self-heals channel membership (e.g. for
        // phone/video consultations where the channel may have been created
        // without the current user as a member) instead of relying solely on
        // membership set up elsewhere at accept-time.
        const members = clerkUserId && peerClerkId ? [clerkUserId, peerClerkId] : undefined
        const ch = streamClient.channel('messaging', id, members ? { members } : undefined)
        await ch.watch({ presence: true } as any)
        if (cancelled) return

        channelRef.current = ch
        const initialMsgs = ch.state.messages
        await preloadImages(getMessageImageUrls(initialMsgs as any[]))
        setChannel(ch)
        setPeerOnline(!!ch.state.members[peerClerkId]?.user?.online)
        setMessages(initialMsgs as unknown as FormatMessageResponse[])
        const loadedIsReadOnly = status === 'completed' || status === 'cancelled' || status === 'ended_abnormally'
        if (!loadedIsReadOnly && isVisibleRef.current) {
          markChannelReadLocally(id, initialMsgs?.[initialMsgs.length - 1]?.id)
          ch.markRead().catch(() => {})
        } else if (!loadedIsReadOnly) {
          // Drawer isn't open yet (e.g. mounted immediately on phone/video
          // page load) — report the channel's real unread count instead of
          // silently marking read, so the in-call badge reflects messages
          // that arrived before this screen was ever visible.
          const unread = ch.countUnread()
          if (unread > 0) onUnreadMessageRef.current?.(unread)
        }

        const readState = (ch.state.read as Record<string, any> | undefined)
        if (peerClerkId && readState?.[peerClerkId]?.last_read) {
          setPeerReadAt(new Date(readState[peerClerkId].last_read))
        }
      } catch (err) {
        logger.error('[Chat] load error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, clerkUserId, role])

  useEffect(() => {
    if (!channel) return

    const unsubPresence = getStreamClient().on('user.presence.changed', event => {
      if (event.user?.id && event.user.id === peerClerkIdRef.current) {
        setPeerOnline(!!event.user.online)
      }
    })

    const unsubNew = channel.on('message.new', event => {
      if (event.message) {
        setMessages(prev => {
          if (prev.some(m => m.id === event.message!.id)) return prev
          return [...prev, event.message as unknown as FormatMessageResponse]
        })
        const fromPeer = event.message.user?.id !== clerkUserId
        // Only mark read when the page tab is focused AND (for the drawer
        // variant) the chat panel is actually visible — a CSS-hidden drawer
        // must not silently mark messages read; it should surface an unread badge.
        const isSeen = !document.hidden && isVisibleRef.current
        if (fromPeer && !isSeen) {
          onUnreadMessageRef.current?.()
          if (document.hidden && Notification.permission === 'granted') {
            const senderName = event.message.user?.name || peerDisplayName
            const browserNotif = new Notification(senderName, {
              body: event.message.text || 'Sent an attachment',
              icon: event.message.user?.image || '/icon.png',
              tag: id,
            })
            browserNotif.onclick = () => {
              window.focus()
              router.push(isDoctor ? `/doctor/consultation/chat/${id}` : `/patient/consultation/chat/${id}`)
              browserNotif.close()
            }
          }
        } else if (fromPeer && !isReadOnlyRef.current) {
          markChannelReadLocally(id, event.message.id)
          channel.markRead().catch(() => {})
        }
      }
    })
    const unsubUpdated = channel.on('message.updated', event => {
      if (event.message) {
        setMessages(prev => prev.map(m => m.id === event.message!.id ? event.message as unknown as FormatMessageResponse : m))
      }
    })
    const unsubDeleted = channel.on('message.deleted', event => {
      if (event.message) {
        setMessages(prev => prev.map(m => m.id === event.message!.id ? event.message as unknown as FormatMessageResponse : m))
      }
    })
    const unsubRead = channel.on('message.read', event => {
      const readerId = (event as any).user?.id
      if (readerId && readerId !== clerkUserId) {
        const ts = (event as any).received_at ?? (event as any).created_at
        if (ts) setPeerReadAt(new Date(ts))
      }
    })
    const unsubStart = channel.on('typing.start', event => {
      if (event.user?.id !== clerkUserId) setPeerTyping(true)
    })
    const unsubStop = channel.on('typing.stop', event => {
      if (event.user?.id !== clerkUserId) setPeerTyping(false)
    })
    // Defense-in-depth: if a typing.stop event is ever dropped (Stream
    // delivery race, dropped socket), the peer's message actually landing is
    // proof they're no longer typing — clear it regardless. Matches the
    // mobile apps' equivalent fallback.
    const unsubTypingClear = channel.on('message.new', event => {
      if (event.message?.user?.id !== clerkUserId) setPeerTyping(false)
    })

    return () => {
      unsubPresence.unsubscribe()
      unsubNew.unsubscribe()
      unsubUpdated.unsubscribe()
      unsubDeleted.unsubscribe()
      unsubRead.unsubscribe()
      unsubStart.unsubscribe()
      unsubStop.unsubscribe()
      unsubTypingClear.unsubscribe()
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      channel.stopTyping().catch(() => {})
    }
  }, [channel, clerkUserId, id, isDoctor])

  // A dropped WS socket resumes silently — re-`watch()` on reconnect so
  // messages sent while offline aren't stuck until the page is reloaded.
  useEffect(() => {
    if (!channel) return
    return onStreamReconnect(() => { channel.watch().catch(() => {}) })
  }, [channel])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchPeerProfile = useCallback(async () => {
    if (peerProfile || profileLoading || !peerClerkIdRef.current) return
    setProfileLoading(true)
    try {
      if (role === 'patient') {
        const { data: consult } = await supabase
          .from('consultations')
          .select('doctor:doctor_profiles(specialty, years_experience, hospital_name, bio, languages, user:users(full_name, profile_photo_url))')
          .eq('id', id)
          .single()
        if (consult) setPeerProfile((consult as any).doctor as PeerProfile)
      } else {
        const { data } = await supabase
          .from('users')
          .select('full_name, gender, country, profile_photo_url')
          .eq('clerk_id', peerClerkIdRef.current)
          .single()
        if (data) setPeerProfile(data as PeerProfile)
      }
    } catch (err) {
      logger.error('[Chat] fetchPeerProfile error:', err)
    } finally {
      setProfileLoading(false)
    }
  }, [id, role, peerProfile, profileLoading])

  const openProfile = useCallback(() => {
    setShowProfile(true)
    setShowMoreMenu(false)
    fetchPeerProfile()
  }, [fetchPeerProfile])

  const handleContextMenu = useCallback((e: React.MouseEvent, message: FormatMessageResponse) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ message, x: e.clientX, y: e.clientY })
  }, [])

  const handleCopy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text) } catch {}
    setContextMenu(null)
  }, [])

  const handleReply = useCallback((message: FormatMessageResponse) => {
    setReplyTo(message)
    setContextMenu(null)
    inputRef.current?.focus()
  }, [])

  const handleDeleteForMe = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId))
    setContextMenu(null)
  }, [])

  const handleReport = useCallback((_message: FormatMessageResponse) => {
    setContextMenu(null)
    setShowReportModal(true)
  }, [])

  const submitReport = useCallback(async () => {
    if (!reportReason) return
    try {
      const token = await getToken()
      if (token && clerkUserId) {
        const client = getAuthClient(token)
        await client.from('consultation_reports').insert({
          consultation_id: id,
          reporter_clerk_id: clerkUserId,
          reporter_role: role,
          reason: reportReason,
          details: reportDetail || null,
        })
      }
    } catch (err) {
      logger.error('[Chat] submitReport error:', err)
    }
    setReportSubmitted(true)
    setReportReason('')
    setReportDetail('')
    setTimeout(() => {
      setShowReportModal(false)
      setReportSubmitted(false)
    }, 1800)
  }, [reportReason, reportDetail, id, getToken, clerkUserId, role])

  const handleSearchResultClick = useCallback((msgId: string) => {
    setSearchActive(false)
    setSearchQuery('')
    setHighlightedMessageId(msgId)
    setTimeout(() => {
      const el = messageRefs.current[msgId]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => setHighlightedMessageId(null), 2500)
    }, 80)
  }, [])

  async function sendMessage() {
    if (isSendingRef.current) return
    isSendingRef.current = true
    try {
      if (pendingFiles.length > 0) {
        await sendFilesWithCaption(pendingFiles.map(f => f.file), input.trim())
        pendingFiles.forEach(f => URL.revokeObjectURL(f.preview))
        setPendingFiles([])
        setInput('')
        return
      }
      const text = input.trim()
      if (!text || !channel) return
      setInput('')
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      channel.stopTyping().catch(() => {})
      await channel.sendMessage({ text, quoted_message_id: replyTo?.id })
      setReplyTo(null)
    } finally {
      isSendingRef.current = false
    }
  }

  async function sendFilesWithCaption(files: File[], caption?: string) {
    if (!channel) return
    setFileUploading(true)
    try {
      const attachments = await Promise.all(
        files.map(async (file) => {
          const res = await channel.sendImage(file)
          return { type: 'image' as const, image_url: res.file, asset_url: res.file }
        })
      )
      await channel.sendMessage({ text: caption || '', attachments, quoted_message_id: replyTo?.id })
      setReplyTo(null)
    } catch (err) {
      logger.error('[Chat] sendFiles error:', err)
    } finally {
      setFileUploading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const newPending = files.map(file => ({ file, preview: URL.createObjectURL(file) }))
    setPendingFiles(prev => [...prev, ...newPending].slice(0, 5))
    e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const isReadOnly = consultation?.status === 'completed' || consultation?.status === 'cancelled' || consultation?.status === 'ended_abnormally'
  useEffect(() => { isReadOnlyRef.current = isReadOnly }, [isReadOnly])
  const rawPeerName = consultation?.peerName ?? (isDoctor ? 'Patient' : 'Doctor')
  const peerDisplayName = isDoctor ? rawPeerName : (rawPeerName ? `Dr. ${stripDrPrefix(rawPeerName)}` : 'Doctor')
  const peerInitial = (isDoctor ? rawPeerName : stripDrPrefix(rawPeerName)).charAt(0).toUpperCase() || (isDoctor ? 'P' : 'D')

  const displayedMessages = messages
  const searchResults = searchActive && searchQuery.trim()
    ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 15)
    : []

  function getDateKey(m: FormatMessageResponse): string {
    if (!m.created_at) return ''
    const d = new Date(m.created_at as any)
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  }

  function highlightText(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-ink-black rounded px-0.5">{part}</mark>
        : part
    )
  }

  function renderQuotedMessage(m: FormatMessageResponse) {
    const qm = m.quoted_message as any
    if (!qm) return null
    const qAtts: Att[] = (qm.attachments as Att[] | undefined) ?? []
    const hasImage = qAtts.some(a => a.type === 'image' || a.image_url)
    const hasAudio = qAtts.some(a => a.type === 'audio' || a.mime_type?.includes('audio'))
    const mine = m.user?.id === clerkUserId
    return (
      <div className={`mb-1.5 px-2.5 py-1.5 rounded-xl border-l-[3px] text-[11px] leading-snug ${
        mine ? 'border-white/60 bg-white/10 text-white/80' : 'border-teal-500 bg-teal-50 text-ink-black/70'
      }`}>
        <p className={`font-semibold text-[10px] mb-0.5 ${mine ? 'text-white/60' : 'text-teal-600'}`}>
          {qm.user?.id === clerkUserId ? 'You' : peerDisplayName}
        </p>
        {hasImage && <span className="inline-flex items-center gap-1"><ImageIcon size={12} /> Photo</span>}
        {hasAudio && <span className="inline-flex items-center gap-1"><Mic size={12} /> Voice note</span>}
        {!hasImage && !hasAudio && <span className="line-clamp-2">{qm.text || '…'}</span>}
      </div>
    )
  }

  function renderAttachments(m: FormatMessageResponse) {
    const atts = getAtts(m)
    const mine = m.user?.id === clerkUserId
    const msgImages = atts.filter(a => a.type === 'image' || a.image_url).map(a => a.image_url ?? a.asset_url ?? '')
    return atts.map((att, i) => {
      if (att.type === 'image' || att.image_url) {
        const src = att.image_url ?? att.asset_url ?? ''
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt="image"
            className="max-w-full rounded-xl mb-1.5 cursor-pointer max-h-64 object-cover block"
            onClick={() => setImageViewer({ images: msgImages, index: msgImages.indexOf(src), message: m })}
          />
        )
      }
      if (att.type === 'audio' || att.mime_type?.includes('audio')) {
        return (
          <div key={i} className="mb-1.5">
            <WebVoiceNotePlayer src={att.asset_url ?? att.file ?? ''} durationSec={typeof att.duration === 'number' ? att.duration : 0} isMine={mine} />
          </div>
        )
      }
      if (att.asset_url || att.file) {
        return (
          <a key={i} href={att.asset_url ?? att.file} target="_blank" rel="noopener noreferrer"
            className={`flex items-center gap-1 text-[11px] underline mb-1 ${mine ? 'text-white/80' : 'text-ink-black/70'}`}>
            <Paperclip size={12} /> {att.title || att.fallback || 'Attachment'}
          </a>
        )
      }
      return null
    })
  }

  function renderStatus(m: FormatMessageResponse) {
    if (m.user?.id !== clerkUserId) return null
    const msgDate = m.created_at ? new Date(m.created_at as any) : null
    const isRead = peerReadAt !== null && msgDate !== null && msgDate <= peerReadAt
    return <span className={`text-[11px] font-bold leading-none ${isRead ? 'text-sky-300' : 'text-white/40'}`}>✓✓</span>
  }

  if (loading) {
    return (
      <div className={isPage ? 'p-8 flex items-center justify-center min-h-[60vh]' : 'flex-1 flex items-center justify-center p-6'}>
        <div className="text-ink-black/40 text-sm">Connecting to chat…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-cloud-grey">
      {showEndSheet && resolvedShowEndButton && (
        <EndConsultationModal
          consultationId={id}
          patientName={peerDisplayName}
          onDone={() => router.replace('/doctor/consultations')}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            {reportSubmitted ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-14 h-14 rounded-full bg-teal-50 flex items-center justify-center">
                  <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#00BFA5" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="font-montserrat font-bold text-ink-black text-base text-center">Report Submitted</p>
                <p className="text-ink-black/50 text-sm text-center">Our team will review it shortly. Thank you.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-montserrat font-bold text-ink-black text-base">Report Consultation</p>
                  <button onClick={() => setShowReportModal(false)} className="w-8 h-8 rounded-full bg-cloud-grey flex items-center justify-center text-ink-black/50 hover:bg-steel-grey/40">
                    <IconClose />
                  </button>
                </div>
                <p className="text-ink-black/50 text-sm">Select a reason for reporting:</p>
                <div className="flex flex-col gap-2">
                  {REPORT_REASONS.map(reason => (
                    <button
                      key={reason}
                      onClick={() => setReportReason(reason)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-colors ${
                        reportReason === reason ? 'border-teal-500 bg-teal-50 text-teal-700 font-semibold' : 'border-steel-grey/30 text-ink-black hover:bg-cloud-grey'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${reportReason === reason ? 'border-teal-500' : 'border-steel-grey'}`}>
                        {reportReason === reason && <span className="w-2 h-2 rounded-full bg-teal-500 block" />}
                      </span>
                      {reason}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reportDetail}
                  onChange={e => setReportDetail(e.target.value)}
                  placeholder="Add details (optional)…"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-steel-grey/30 text-sm text-ink-black placeholder:text-ink-black/30 resize-none focus:outline-none focus:border-teal-500 transition-colors"
                />
                <button
                  onClick={submitReport}
                  disabled={!reportReason}
                  className="w-full py-3 rounded-xl bg-teal-500 text-white font-montserrat font-bold text-sm hover:bg-teal-600 transition-colors disabled:opacity-40"
                >
                  Submit Report
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 items-center text-center" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#EF4444" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-montserrat font-bold text-ink-black text-base">Block {peerDisplayName}?</p>
            <p className="text-ink-black/50 text-sm leading-relaxed">You will no longer receive messages from this {isDoctor ? 'patient' : 'doctor'}. The consultation history is preserved.</p>
            <div className="flex flex-col gap-2 w-full">
              <button onClick={() => { setShowBlockModal(false); setIsBlocked(true) }} className="w-full py-3 rounded-xl bg-danger text-white font-montserrat font-bold text-sm hover:opacity-90 transition-opacity">
                Block {isDoctor ? 'Patient' : 'Doctor'}
              </button>
              <button onClick={() => setShowBlockModal(false)} className="w-full py-3 rounded-xl bg-cloud-grey text-ink-black font-montserrat font-semibold text-sm hover:bg-steel-grey/40 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-40 bg-white rounded-xl shadow-2xl border border-steel-grey/30 py-1 min-w-[160px] overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const m = contextMenu.message
            const hasText = !!(m.text && m.text.trim())
            return (
              <>
                <button onClick={() => handleReply(m)} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-2.5">
                  <span className="text-ink-black/50"><IconReply /></span> Reply
                </button>
                {hasText && (
                  <button onClick={() => handleCopy(m.text ?? '')} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-2.5">
                    <span className="text-ink-black/50"><IconCopy /></span> Copy
                  </button>
                )}
                <button onClick={() => handleDeleteForMe(m.id)} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-2.5">
                  <span className="text-ink-black/50"><IconDelete /></span> Delete for Me
                </button>
                <div className="my-1 border-t border-steel-grey/20" />
                <button onClick={() => handleReport(m)} className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/5 flex items-center gap-2.5">
                  <span className="text-danger"><IconFlagSm /></span> Report
                </button>
              </>
            )
          })()}
        </div>
      )}

      {showProfile && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setShowProfile(false)}>
          <div className="bg-white w-full sm:w-96 rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-3 pb-2 border-b border-steel-grey/20">
              {consultation?.peerPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={consultation.peerPhotoUrl} alt={peerDisplayName} className="w-20 h-20 rounded-full object-cover shadow-lg" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-teal-500 flex items-center justify-center text-white font-black text-3xl shadow-lg">
                  {peerInitial}
                </div>
              )}
              <div className="text-center">
                <p className="font-montserrat font-bold text-ink-black text-lg">{peerProfile?.full_name ?? peerDisplayName}</p>
                {!isDoctor && consultation?.peerSpecialty && (
                  <p className="text-teal-600 text-sm font-semibold">{consultation.peerSpecialty}</p>
                )}
                {isDoctor && <p className="text-ink-black/50 text-sm">Patient</p>}
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <div className={`w-2 h-2 rounded-full ${isReadOnly ? 'bg-steel-grey' : 'bg-green-500'}`} />
                  <span className={`text-xs font-semibold ${isReadOnly ? 'text-ink-black/40' : 'text-green-600'}`}>
                    {isReadOnly ? 'Ended' : 'Active'}
                  </span>
                </div>
              </div>
            </div>
            {profileLoading && <p className="text-center text-ink-black/40 text-sm py-4">Loading profile…</p>}
            {peerProfile && !profileLoading && !isDoctor && (
              <div className="flex flex-col gap-3">
                {peerProfile.years_experience != null && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">Experience</p>
                    <p className="text-sm text-ink-black">{peerProfile.years_experience} years</p>
                  </div>
                )}
                {peerProfile.hospital_name && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">Hospital / Clinic</p>
                    <p className="text-sm text-ink-black">{peerProfile.hospital_name}</p>
                  </div>
                )}
                {peerProfile.languages && peerProfile.languages.length > 0 && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">Languages</p>
                    <p className="text-sm text-ink-black">{peerProfile.languages.join(', ')}</p>
                  </div>
                )}
                {peerProfile.bio && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">About</p>
                    <p className="text-sm text-ink-black leading-relaxed">{peerProfile.bio}</p>
                  </div>
                )}
              </div>
            )}
            {peerProfile && !profileLoading && isDoctor && (
              <div className="flex flex-col gap-3">
                {peerProfile.gender && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">Gender</p>
                    <p className="text-sm text-ink-black capitalize">{peerProfile.gender}</p>
                  </div>
                )}
                {peerProfile.country && (
                  <div>
                    <p className="text-[11px] text-ink-black/40 font-semibold uppercase tracking-wide">Country</p>
                    <p className="text-sm text-ink-black">{peerProfile.country}</p>
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setShowProfile(false)} className="mt-2 w-full py-3 rounded-xl bg-teal-500 text-white font-montserrat font-bold text-sm hover:bg-teal-600 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className={`sticky top-0 z-30 bg-white border-b border-steel-grey/40 flex items-center gap-3 shadow-sm ${isPage ? 'px-4 py-3' : 'px-3 py-2.5'}`}>
        {isPage ? (
          <button onClick={() => router.push(`/${role}/messages`)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl hover:bg-cloud-grey transition-colors text-ink-black/60" aria-label="Go back">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : null}

        <button onClick={openProfile} className={`flex-shrink-0 rounded-full overflow-hidden bg-teal-500 flex items-center justify-center text-white font-bold hover:opacity-90 transition-opacity ${isPage ? 'w-10 h-10 text-base' : 'w-8 h-8 text-sm'}`} aria-label={`View ${isDoctor ? 'patient' : 'doctor'} profile`}>
          {consultation?.peerPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={consultation.peerPhotoUrl} alt={peerDisplayName} className="w-full h-full object-cover" />
          ) : peerInitial}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`font-montserrat font-bold text-ink-black truncate ${isPage ? 'text-sm' : 'text-xs'}`}>{peerDisplayName}</p>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isReadOnly ? 'bg-steel-grey' : peerOnline ? 'bg-green-500' : 'bg-steel-grey'}`} />
            <span className={`text-xs font-medium ${isReadOnly || !peerOnline ? 'text-ink-black/40' : 'text-green-600'}`}>
              {isReadOnly ? 'Ended' : peerOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {resolvedShowEndButton && !isReadOnly && (
          <button onClick={() => setShowEndSheet(true)} className="flex-shrink-0 text-xs text-danger font-semibold px-3 py-1.5 rounded-lg border border-danger/20 bg-danger/5 hover:bg-danger/10 transition-colors">
            End
          </button>
        )}

        <div className="relative" ref={moreMenuRef}>
          <button onClick={(e) => { e.stopPropagation(); setShowMoreMenu(v => !v) }} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-cloud-grey transition-colors text-ink-black/60" aria-label="More options">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-2xl border border-steel-grey/30 py-1 min-w-[190px] z-40 overflow-hidden">
              <button onClick={openProfile} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3">
                <span className="text-ink-black/50"><IconUser /></span> View Profile
              </button>
              {isDoctor && consultation?.peerPatientId && (
                <button
                  onClick={() => { setShowMoreMenu(false); router.push(`/doctor/patient/${consultation.peerPatientId}`) }}
                  className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3"
                >
                  <span className="text-ink-black/50"><IconUser /></span> Patient History
                </button>
              )}
              <button onClick={() => { setSearchActive(true); setShowMoreMenu(false) }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3">
                <span className="text-ink-black/50"><IconSearch /></span> Search Messages
              </button>
              <button onClick={() => { setMessages([]); setShowMoreMenu(false) }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3">
                <span className="text-danger"><IconTrash /></span> <span className="text-danger">Clear Chat</span>
              </button>
              <div className="my-1 border-t border-steel-grey/20" />
              <button onClick={() => { setShowMoreMenu(false); setShowReportModal(true) }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black/70 hover:bg-cloud-grey flex items-center gap-3">
                <span className="text-ink-black/50"><IconFlag /></span> Report
              </button>
              <button onClick={() => { setShowMoreMenu(false); setShowBlockModal(true) }} className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/5 flex items-center gap-3">
                <span className="text-danger"><IconBan /></span> Block
              </button>
            </div>
          )}
        </div>

        {!isPage && (
          <button onClick={onClose} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl hover:bg-cloud-grey transition-colors text-ink-black/60" aria-label="Close chat">
            <IconClose />
          </button>
        )}
      </div>

      {searchActive && (
        <div className="bg-white border-b border-steel-grey/30">
          <div className="px-4 py-2 flex items-center gap-2 border-b border-steel-grey/20">
            <span className="text-ink-black/40"><IconSearch /></span>
            <input autoFocus type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search messages…"
              className="flex-1 text-sm text-ink-black bg-transparent outline-none placeholder:text-ink-black/30" />
            <button onClick={() => { setSearchActive(false); setSearchQuery('') }} className="text-ink-black/40 hover:text-ink-black text-lg leading-none">✕</button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {searchResults.map(m => {
                const msgDate = m.created_at ? new Date(m.created_at as any) : null
                return (
                  <button key={m.id} onClick={() => handleSearchResultClick(m.id)} className="w-full px-4 py-2 text-left hover:bg-cloud-grey flex flex-col gap-0.5 border-b border-steel-grey/10 last:border-0">
                    <span className="text-[10px] text-ink-black/40">
                      {m.user?.id === clerkUserId ? 'You' : peerDisplayName}
                      {msgDate ? ` · ${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                    <span className="text-sm text-ink-black truncate">{highlightText(m.text ?? '…', searchQuery)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {searchQuery.trim() && searchResults.length === 0 && (
            <p className="px-4 py-3 text-sm text-ink-black/40">No messages match your search.</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1">
        {!isReadOnly && (
          <div className="flex justify-center mb-2">
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-3 py-1 flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 inline-block" />
              Active Consultation
            </span>
          </div>
        )}

        {displayedMessages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-center py-16">
            <div className="flex flex-col items-center gap-3">
              <MessageCircle size={44} className="text-steel-grey" />
              <p className="font-montserrat font-bold text-ink-black/70 text-base">
                {isDoctor ? 'Consultation started' : 'Your consultation has started.'}
              </p>
              <p className="text-ink-black/40 text-sm max-w-[260px] leading-relaxed">
                {isDoctor
                  ? 'Send the first message to begin the consultation.'
                  : 'Describe your symptoms in as much detail as possible. You may also attach photos or medical documents.'}
              </p>
            </div>
          </div>
        )}

        {(() => {
          let lastDateKey = ''
          return displayedMessages.map(m => {
            const mine = m.user?.id === clerkUserId
            const isDeleted = m.type === 'deleted' || !!(m as any).deleted_at
            const atts = getAtts(m)
            const hasAudio = atts.some(a => a.type === 'audio' || a.mime_type?.includes('audio'))
            const msgDate = m.created_at ? new Date(m.created_at as any) : null
            const dateKey = getDateKey(m)
            const showDateSep = dateKey && dateKey !== lastDateKey
            if (showDateSep) lastDateKey = dateKey

            return (
              <div key={m.id} ref={(el) => { if (el) messageRefs.current[m.id] = el; else delete messageRefs.current[m.id] }}>
                {showDateSep && msgDate && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] bg-white/80 text-ink-black/40 rounded-full px-3 py-0.5 shadow-sm border border-steel-grey/20">
                      {formatDateSeparator(msgDate)}
                    </span>
                  </div>
                )}
                {isDeleted ? (
                  <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-1`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm italic ${mine ? 'bg-teal-400/50 text-white/60' : 'bg-white text-ink-black/40 shadow-sm'}`}>
                      This message was deleted.
                    </div>
                  </div>
                ) : (
                  <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-1`} onContextMenu={(e) => handleContextMenu(e, m)}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm shadow-sm transition-colors duration-300 ${
                      mine ? 'bg-teal-500 text-white rounded-br-sm' : 'bg-white text-ink-black rounded-bl-sm'
                    } ${highlightedMessageId === m.id ? 'ring-2 ring-yellow-400 shadow-yellow-200 shadow-lg' : ''}`}>
                      {renderQuotedMessage(m)}
                      {renderAttachments(m)}
                      {m.text && !hasAudio && <span>{m.text}</span>}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className={`text-[10px] ${mine ? 'text-white/60' : 'text-ink-black/40'}`}>
                          {msgDate ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                        {renderStatus(m)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        })()}

        {isReadOnly && (
          <div className="flex justify-center my-3">
            <span className="text-xs bg-white text-ink-black/50 border border-steel-grey/30 rounded-full px-4 py-1.5 flex items-center gap-1.5 shadow-sm">
              ✓ Consultation Completed — This conversation is now read-only.
            </span>
          </div>
        )}

        {isBlocked && (
          <div className="flex justify-center my-3">
            <span className="text-xs bg-danger/5 text-danger border border-danger/20 rounded-full px-4 py-1.5 flex items-center gap-1.5">
              <IconBan /> This user has been blocked.
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {peerTyping && (
        <div className="px-5 py-2 bg-white border-t border-steel-grey/20">
          <div className="flex items-center gap-2">
            <div className="flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-black/30 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-black/30 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-black/30 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-ink-black/40">{peerDisplayName} is typing…</span>
          </div>
        </div>
      )}

      {!isReadOnly && !isBlocked && (
        <div className="bg-white border-t border-steel-grey/30">
          {pendingFiles.length > 0 && (
            <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto border-b border-steel-grey/20 scrollbar-hide">
              {pendingFiles.map((pf, i) => (
                <div key={i} className="relative flex-shrink-0">
                  {pf.file.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pf.preview} alt="Preview" className="h-16 w-16 rounded-xl object-cover border border-steel-grey" />
                  ) : (
                    <div className="h-16 w-16 rounded-xl bg-cloud-grey border border-steel-grey flex items-center justify-center">
                      <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="text-ink-black/40">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  )}
                  <button onClick={() => removePendingFile(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white text-xs flex items-center justify-center hover:opacity-80 transition-opacity shadow" aria-label="Remove file">✕</button>
                </div>
              ))}
            </div>
          )}

          {replyTo && (
            <div className="px-4 pt-2 pb-1 flex items-center gap-2 border-b border-steel-grey/20">
              <div className="flex-1 pl-3 border-l-[3px] border-teal-500">
                <p className="text-[11px] text-teal-600 font-semibold">{replyTo.user?.id === clerkUserId ? 'You' : peerDisplayName}</p>
                <p className="text-xs text-ink-black/60 truncate">
                  {getAtts(replyTo).some(a => a.type === 'image' || a.image_url)
                    ? 'Photo'
                    : getAtts(replyTo).some(a => a.type === 'audio' || a.mime_type?.includes('audio'))
                    ? 'Voice note'
                    : replyTo.text || '…'}
                </p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-ink-black/40 hover:text-ink-black text-lg leading-none" aria-label="Cancel reply">✕</button>
            </div>
          )}

          <div className="px-4 pt-2 flex justify-center">
            <p className="text-[10px] text-ink-black/30 flex items-center gap-1">
              <IconLock /> Encrypted and Private
            </p>
          </div>

          <div className="px-4 py-3 flex gap-2 items-end">
            <input type="file" accept="image/*" multiple ref={photoInputRef} className="hidden" onChange={handleFileSelect} />
            <input type="file" accept="application/pdf,.doc,.docx,.txt" ref={docInputRef} className="hidden" onChange={handleFileSelect} />

            <div className="relative" ref={attachMenuRef}>
              <button onClick={(e) => { e.stopPropagation(); setShowAttachMenu(v => !v) }} disabled={fileUploading || pendingFiles.length >= 5}
                title="Attach file" aria-label="Attach file"
                className="w-10 h-10 flex-shrink-0 rounded-xl bg-cloud-grey flex items-center justify-center text-ink-black/50 hover:bg-steel-grey/60 transition-colors disabled:opacity-40">
                {fileUploading ? <span className="animate-spin text-base">⏳</span> : <IconAttach />}
              </button>
              {showAttachMenu && (
                <div className="absolute bottom-full mb-2 left-0 bg-white rounded-xl shadow-2xl border border-steel-grey/30 py-2 min-w-[200px] z-40 overflow-hidden">
                  <button onClick={() => { setShowAttachMenu(false); photoInputRef.current?.click() }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3 transition-colors">
                    <span className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 flex-shrink-0"><IconImage /></span>
                    <span>
                      <span className="block font-semibold text-[13px]">Choose Photo</span>
                      <span className="block text-[11px] text-ink-black/40">Images from your device</span>
                    </span>
                  </button>
                  <div className="mx-4 my-1 h-px bg-steel-grey/20" />
                  <button onClick={() => { setShowAttachMenu(false); docInputRef.current?.click() }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-3 transition-colors">
                    <span className="w-8 h-8 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 flex-shrink-0"><IconDocument /></span>
                    <span>
                      <span className="block font-semibold text-[13px]">Choose Document</span>
                      <span className="block text-[11px] text-ink-black/40">PDF, Word, or any file</span>
                    </span>
                  </button>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => {
                setInput(e.target.value)
                if (channel) {
                  channel.keystroke()
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
                  typingTimeoutRef.current = setTimeout(() => channel.stopTyping().catch(() => {}), 2000)
                }
              }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={pendingFiles.length > 0 ? 'Add a caption…' : 'Type a message…'}
              className="flex-1 h-11 px-4 rounded-2xl border border-steel-grey bg-cloud-grey font-montserrat text-sm text-ink-black placeholder:text-ink-black/40 focus:outline-none focus:border-teal-500 transition-colors"
            />
            <button onClick={sendMessage} disabled={(!input.trim() && pendingFiles.length === 0) || fileUploading}
              className="w-11 h-11 flex-shrink-0 rounded-2xl bg-teal-500 text-white flex items-center justify-center hover:bg-teal-600 transition-colors disabled:opacity-30" aria-label="Send message">
              <IconSend />
            </button>
          </div>
        </div>
      )}

      {!isReadOnly && isBlocked && (
        <div className="bg-white border-t border-steel-grey/30 px-4 py-4 flex items-center justify-center gap-2">
          <span className="text-danger"><IconBan /></span>
          <p className="text-sm text-ink-black/50">You have blocked this {isDoctor ? 'patient' : 'doctor'}. Messaging is disabled.</p>
        </div>
      )}

      {isPage && isReadOnly && !isDoctor && (
        <div className="bg-white border-t border-steel-grey/30 px-4 py-3 flex justify-center">
          <Link href={`/patient/summary/${id}`} className="flex items-center gap-2 text-sm font-semibold text-teal-600 px-4 py-2 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 transition-colors">
            <ClipboardList size={16} /> View Consultation Summary
          </Link>
        </div>
      )}

      {imageViewer && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={() => { setImageViewer(null); setShowImageMenu(false) }}>
          <div className="flex items-center justify-between p-4 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setImageViewer(null); setShowImageMenu(false) }} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="Close">
              <IconClose />
            </button>
            {imageViewer.images.length > 1 && (
              <span className="text-white/60 text-sm font-medium tabular-nums">{imageViewer.index + 1} / {imageViewer.images.length}</span>
            )}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowImageMenu(v => !v) }} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="More options">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
              {showImageMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-2xl border border-steel-grey/30 py-1 min-w-[170px] z-50 overflow-hidden">
                  <button onClick={() => { setShowImageMenu(false); window.open(imageViewer.images[imageViewer.index], '_blank') }} className="w-full px-4 py-2.5 text-left text-sm text-ink-black hover:bg-cloud-grey flex items-center gap-2.5">
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                    View Details
                  </button>
                  <button onClick={() => { setShowImageMenu(false); handleDeleteForMe(imageViewer.message.id); setImageViewer(null) }} className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/5 flex items-center gap-2.5">
                    <IconDelete /> Delete for Me
                  </button>
                  <button onClick={() => { setShowImageMenu(false); handleReport(imageViewer.message); setImageViewer(null) }} className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/5 flex items-center gap-2.5">
                    <IconFlagSm /> Report
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 flex items-center gap-3 px-2 overflow-hidden" onClick={e => e.stopPropagation()}>
            {imageViewer.images.length > 1 && (
              <button onClick={() => setImageViewer(prev => prev ? { ...prev, index: Math.max(0, prev.index - 1) } : null)} disabled={imageViewer.index === 0}
                className="w-10 h-10 flex-shrink-0 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-20 transition-colors" aria-label="Previous image">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
            )}
            <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageViewer.images[imageViewer.index]} alt="Full size" className="max-h-full max-w-full object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
            </div>
            {imageViewer.images.length > 1 && (
              <button onClick={() => setImageViewer(prev => prev ? { ...prev, index: Math.min(prev.images.length - 1, prev.index + 1) } : null)} disabled={imageViewer.index === imageViewer.images.length - 1}
                className="w-10 h-10 flex-shrink-0 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-20 transition-colors" aria-label="Next image">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
