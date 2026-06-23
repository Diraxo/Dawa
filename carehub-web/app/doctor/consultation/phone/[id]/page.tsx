'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuth, useUser } from '@clerk/nextjs'
import { uidFromString, fetchAgoraToken } from '@/lib/agora'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng'
import type { Channel } from 'stream-chat'

interface Consultation {
  id: string
  status: string
  patient: { full_name: string; clerk_id: string } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'error'

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for patient…',
  connected: 'On Call',
  error: 'Connection failed',
}

interface ChatMsg { id: string; text: string; userId: string; createdAt: string; attachmentUrl?: string }

function toMsg(raw: Record<string, unknown>): ChatMsg {
  const attachments = (raw.attachments as Record<string, unknown>[] | undefined) ?? []
  const attachment = attachments[0]
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    userId: String((raw.user as Record<string, unknown>)?.id ?? ''),
    createdAt: String(raw.created_at ?? ''),
    attachmentUrl: attachment ? String(attachment.image_url ?? attachment.asset_url ?? '') : undefined,
  }
}

export default function DoctorPhoneConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [showEndSheet, setShowEndSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
  const channelRef = useRef<Channel | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load consultation
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, status, patient:users!patient_id(full_name, clerk_id)')
        .eq('id', id)
        .single()
      setConsultation(data as unknown as Consultation)
      setLoading(false)
    }
    load()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Agora audio call
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
    if (!appId || !id || !user) return
    const appIdStr = appId as string
    const channelId = id as string
    let mounted = true

    async function joinCall() {
      try {
        const clerkToken = await getToken()
        if (!clerkToken || !mounted) return

        const uid = uidFromString(user!.id)
        const agoraToken = await fetchAgoraToken(channelId, uid, clerkToken)
        if (!mounted) return

        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng')
        if (!mounted) return

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        agoraClientRef.current = client

        client.on('user-published', async (remoteUser, mediaType) => {
          await client.subscribe(remoteUser, mediaType)
          if (mediaType === 'audio') {
            remoteUser.audioTrack?.play()
            if (mounted) {
              setCallStatus('connected')
              // Start timer when patient joins the call
              if (!timerRef.current) {
                timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
              }
            }
          }
        })
        client.on('user-unpublished', () => {
          if (mounted) setCallStatus('waiting')
        })

        await client.join(appIdStr, channelId, agoraToken, uid)
        if (!mounted) return

        const mic = await AgoraRTC.createMicrophoneAudioTrack()
        micTrackRef.current = mic
        if (!mounted) { mic.close(); return }

        await client.publish([mic])
        if (mounted) setCallStatus('waiting')
      } catch (err) {
        logger.error('[Agora] Doctor phone call error:', err)
        if (mounted) setCallStatus('error')
      }
    }

    joinCall()

    return () => {
      mounted = false
      micTrackRef.current?.close()
      micTrackRef.current = null
      agoraClientRef.current?.leave()
      agoraClientRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  // Sync mute
  useEffect(() => {
    micTrackRef.current?.setEnabled(!muted)
  }, [muted])

  // Initialize Stream Chat channel when chat is opened
  async function initChat() {
    if (channelRef.current || !user || !consultation) return
    setChatLoading(true)
    try {
      const clerkToken = await getToken()
      if (!clerkToken) return
      const streamToken = await fetchStreamToken(clerkToken)
      const client = getStreamClient()
      if (!client.userID) {
        await client.connectUser({ id: user.id, name: user.fullName ?? 'Doctor' }, streamToken)
      }
      const patientClerkId = consultation.patient?.clerk_id ?? ''
      const members = [user.id, patientClerkId].filter(Boolean)
      const channel = client.channel('messaging', id, { members })
      channelRef.current = channel
      const state = await channel.watch()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages((state.messages ?? []).map((m: any) => toMsg(m)))
      channel.on('message.new', (event) => {
        if (!event.message) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setMessages(prev => [...prev, toMsg(event.message as any)])
      })
    } catch (err) {
      logger.error('[Stream] Phone chat init error:', err)
    } finally {
      setChatLoading(false)
    }
  }

  async function openChat() {
    setChatOpen(true)
    await initChat()
  }

  async function sendMessage() {
    const text = chatInput.trim()
    if (!text || !channelRef.current) return
    setChatInput('')
    await channelRef.current.sendMessage({ text })
  }

  async function sendFile(file: File) {
    if (!channelRef.current) return
    setFileUploading(true)
    try {
      const res = await channelRef.current.sendImage(file)
      await channelRef.current.sendMessage({
        text: '',
        attachments: [{ type: 'image', image_url: res.file, asset_url: res.file }],
      })
    } catch (err) {
      logger.error('[Stream] Image upload error:', err)
    } finally {
      setFileUploading(false)
    }
  }

  function handleEndDone() {
    if (timerRef.current) clearInterval(timerRef.current)
    micTrackRef.current?.close()
    agoraClientRef.current?.leave()
    channelRef.current?.stopWatching()
    router.replace('/doctor/consultations')
  }

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070E27] flex items-center justify-center">
        <div className="text-white/40 text-sm">Connecting…</div>
      </div>
    )
  }

  const patientName = consultation?.patient?.full_name ?? 'Patient'

  return (
    <div className="min-h-screen bg-[#070E27] flex">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id}
          patientName={patientName}
          elapsedSeconds={elapsed}
          onDone={handleEndDone}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Main call area */}
      <div className={`flex flex-col items-center justify-between p-6 py-14 transition-all duration-300 ${chatOpen ? 'flex-1' : 'w-full'}`}>
        {/* Patient info */}
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          <p className={`text-xs uppercase tracking-widest font-bold mb-8 ${
            callStatus === 'connected' ? 'text-teal-green' :
            callStatus === 'error' ? 'text-danger' : 'text-white/50'
          }`}>
            {STATUS_LABEL[callStatus]}
          </p>

          <div className="relative mb-6">
            {callStatus === 'connected' && (
              <>
                <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" style={{ transform: 'scale(1.3)' }} />
                <div className="absolute inset-0 rounded-full bg-white/5 animate-ping" style={{ transform: 'scale(1.6)', animationDelay: '0.4s' }} />
              </>
            )}
            <div className="relative w-36 h-36 rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white font-black text-5xl shadow-lg">
              {patientName.charAt(0)}
            </div>
          </div>

          <h1 className="font-montserrat font-black text-2xl text-white mb-1">{patientName}</h1>
          <p className="text-white/50 text-sm mb-2">Patient</p>
          <p className="font-mono text-white/70 text-xl mb-8">{formatTime(elapsed)}</p>

          <div className="flex items-center gap-1 h-8">
            {[4, 8, 6, 14, 10, 6, 12, 8, 5, 10, 7, 4].map((h, i) => (
              <div key={i} className="w-1 rounded-full bg-teal-green/70 transition-all duration-300"
                style={{ height: muted || callStatus !== 'connected' ? 3 : h, opacity: callStatus === 'connected' ? 0.7 : 0.2 }} />
            ))}
          </div>

          {callStatus === 'error' && (
            <p className="text-danger/70 text-xs mt-4 max-w-xs text-center">
              Could not connect. Check microphone permissions and reload.
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center gap-2">
              <button onClick={() => setMuted(m => !m)}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${muted ? 'bg-care-blue' : 'bg-white/10 hover:bg-white/20'}`}>
                {muted ? '🔇' : '🎤'}
              </button>
              <span className="text-white/50 text-[10px]">{muted ? 'Unmute' : 'Mute'}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button onClick={() => setShowEndSheet(true)}
                className="w-20 h-20 rounded-full bg-danger flex items-center justify-center text-white text-2xl hover:bg-danger/80 transition-colors"
                style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
                📵
              </button>
              <span className="text-white/50 text-[10px]">End</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button onClick={chatOpen ? () => setChatOpen(false) : openChat}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/10 hover:bg-white/20'}`}>
                💬
              </button>
              <span className="text-white/50 text-[10px]">Chat</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div className="w-80 bg-white flex flex-col border-l border-steel-grey">
          <div className="bg-white border-b border-steel-grey px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">Chat with {patientName}</p>
              <p className="text-xs text-ink-black/40">Share notes, images, medicine names</p>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-ink-black/40 hover:text-ink-black text-lg">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-cloud-grey">
            {chatLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-ink-black/30 text-sm">Connecting…</div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center p-4">
                <div>
                  <p className="text-2xl mb-2">💬</p>
                  <p className="text-ink-black/40 text-xs">No messages yet. Start chatting with {patientName}.</p>
                </div>
              </div>
            ) : (
              messages.map(m => {
                const mine = m.userId === user?.id
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${mine ? 'bg-int-blue text-white rounded-br-sm' : 'bg-white text-ink-black rounded-bl-sm shadow-sm'}`}>
                      {m.attachmentUrl && (
                        <img src={m.attachmentUrl} alt="attachment" className="max-w-full rounded-lg mb-1" />
                      )}
                      {m.text && <p>{m.text}</p>}
                      <p className={`text-[9px] mt-0.5 ${mine ? 'text-white/60' : 'text-ink-black/40'}`}>
                        {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-steel-grey p-3 flex gap-2 items-end">
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={fileUploading}
              className="w-9 h-9 rounded-xl bg-cloud-grey flex items-center justify-center text-sm text-ink-black/50 hover:bg-steel-grey transition-colors disabled:opacity-40 flex-shrink-0">
              {fileUploading ? '⏳' : '📎'}
            </button>
            <input
              type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message…"
              className="flex-1 h-9 px-3 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue"
            />
            <button onClick={sendMessage} disabled={!chatInput.trim()}
              className="h-9 px-3 rounded-xl bg-int-blue text-white font-bold text-xs disabled:opacity-40 flex-shrink-0">
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
