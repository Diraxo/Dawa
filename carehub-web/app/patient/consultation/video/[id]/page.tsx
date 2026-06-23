'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { logger } from '@/lib/logger'
import { getAuthClient } from '@/lib/supabase'
import { uidFromString, fetchAgoraToken } from '@/lib/agora'
import { getStreamClient, fetchStreamToken } from '@/lib/stream'
import { stripDrPrefix } from '@/lib/utils'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, ICameraVideoTrack } from 'agora-rtc-sdk-ng'
import type { Channel } from 'stream-chat'

interface Consultation {
  id: string
  status: string
  started_at: string | null
  doctor: {
    specialty: string
    user: { full_name: string; clerk_id: string } | null
  } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'error'

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

export default function VideoConsultationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [callStatus, setCallStatus] = useState<CallStatus>('connecting')
  const [ending, setEnding] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
  const camTrackRef = useRef<ICameraVideoTrack | null>(null)
  const remoteVideoRef = useRef<HTMLDivElement>(null)
  const localVideoRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<Channel | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load consultation info
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, status, started_at, doctor:doctor_profiles(specialty, user:users(full_name, clerk_id))')
        .eq('id', id)
        .single()
      setConsultation(data as unknown as Consultation)
      setLoading(false)
    }
    load()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id])

  // Start timer only once the doctor joins (connected status)
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [callStatus])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Agora video call
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
          if (mediaType === 'video' && remoteVideoRef.current && mounted) {
            remoteUser.videoTrack?.play(remoteVideoRef.current)
            setCallStatus('connected')
          }
          if (mediaType === 'audio') {
            remoteUser.audioTrack?.play()
          }
        })
        client.on('user-unpublished', () => {
          if (mounted) setCallStatus('waiting')
        })

        await client.join(appIdStr, channelId, agoraToken, uid)
        if (!mounted) return

        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks()
        micTrackRef.current = mic
        camTrackRef.current = cam
        if (!mounted) { mic.close(); cam.close(); return }

        if (localVideoRef.current) {
          cam.play(localVideoRef.current)
        }

        await client.publish([mic, cam])
        if (mounted) setCallStatus('waiting')
      } catch (err) {
        logger.error('[Agora] Video call error:', err)
        if (mounted) setCallStatus('error')
      }
    }

    joinCall()

    return () => {
      mounted = false
      micTrackRef.current?.close()
      micTrackRef.current = null
      camTrackRef.current?.close()
      camTrackRef.current = null
      agoraClientRef.current?.leave()
      agoraClientRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  // Sync mute
  useEffect(() => {
    micTrackRef.current?.setEnabled(!muted)
  }, [muted])

  // Sync camera
  useEffect(() => {
    camTrackRef.current?.setEnabled(!camOff)
  }, [camOff])

  // Initialize Stream Chat channel
  async function initChat() {
    if (channelRef.current || !user || !consultation) return
    setChatLoading(true)
    try {
      const clerkToken = await getToken()
      if (!clerkToken) return
      const streamToken = await fetchStreamToken(clerkToken)
      const client = getStreamClient()
      if (!client.userID) {
        await client.connectUser({ id: user.id, name: user.fullName ?? 'Patient' }, streamToken)
      }
      const doctorClerkId = consultation.doctor?.user?.clerk_id ?? ''
      const members = [user.id, doctorClerkId].filter(Boolean)
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
      logger.error('[Stream] Chat init error:', err)
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

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  async function endCall() {
    setEnding(true)
    if (timerRef.current) clearInterval(timerRef.current)
    micTrackRef.current?.close()
    camTrackRef.current?.close()
    await agoraClientRef.current?.leave()
    channelRef.current?.stopWatching()
    const token = await getToken()
    if (!token) { setEnding(false); return }
    const client = getAuthClient(token)
    await client.from('consultations').update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_minutes: Math.ceil(elapsed / 60),
    }).eq('id', id)
    router.push(`/patient/summary/${id}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-white/40 text-sm">Connecting video…</div>
      </div>
    )
  }

  const doctorName = stripDrPrefix(consultation?.doctor?.user?.full_name ?? 'Doctor')

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex">
      {/* Main video area */}
      <div className={`flex flex-col relative overflow-hidden transition-all duration-300 ${chatOpen ? 'flex-1' : 'w-full'}`}>
        {/* Remote video — doctor (full screen) */}
        <div className="flex-1 relative bg-[#111827]">
          <div ref={remoteVideoRef} className="absolute inset-0" />

          {/* Placeholder when no remote video */}
          {callStatus !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-40 h-40 rounded-full bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white font-black text-6xl mx-auto mb-4 shadow-lg">
                  {doctorName.charAt(0)}
                </div>
                <p className="text-white/60 text-sm">Dr. {doctorName}</p>
                <p className="text-white/40 text-xs mt-1">
                  {callStatus === 'connecting' ? 'Connecting…' :
                   callStatus === 'error' ? 'Connection failed' : 'Waiting for doctor…'}
                </p>
              </div>
            </div>
          )}

          {/* Timer + LIVE */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <div className="bg-black/50 rounded-full px-3 py-1.5 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
              <span className="text-white text-xs font-bold tracking-wider">LIVE</span>
            </div>
            <div className="bg-black/50 rounded-full px-4 py-1.5">
              <span className="text-white font-mono text-sm">{formatTime(elapsed)}</span>
            </div>
          </div>

          {/* Local camera — bottom right corner */}
          <div className="absolute bottom-4 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-lg bg-[#1F2937]">
            <div ref={localVideoRef} className="absolute inset-0" />
            {camOff && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/40">
                <span className="text-2xl">📷</span>
                <span className="text-[9px]">Camera off</span>
              </div>
            )}
            <span className="absolute bottom-1 left-0 right-0 text-center text-white/60 text-[9px] z-10">You</span>
          </div>
        </div>

        {/* Controls bar */}
        <div className="bg-black/85 px-6 py-5 flex items-center justify-center gap-6">
          {/* Mute */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setMuted(m => !m)}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${muted ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
              {muted ? '🔇' : '🎤'}
            </button>
            <span className="text-white/50 text-[10px]">{muted ? 'Unmute' : 'Mute'}</span>
          </div>

          {/* Camera */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => setCamOff(c => !c)}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${camOff ? 'bg-[#374151]' : 'bg-white/15 hover:bg-white/25'}`}>
              {camOff ? '📷' : '🎥'}
            </button>
            <span className="text-white/50 text-[10px]">{camOff ? 'Cam On' : 'Cam Off'}</span>
          </div>

          {/* End call */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={endCall} disabled={ending}
              className="w-16 h-16 rounded-full bg-danger flex items-center justify-center text-white text-2xl hover:bg-danger/80 transition-colors disabled:opacity-50"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}>
              📵
            </button>
            <span className="text-white/50 text-[10px]">End Call</span>
          </div>

          {/* Chat */}
          <div className="flex flex-col items-center gap-1">
            <button onClick={chatOpen ? () => setChatOpen(false) : openChat}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${chatOpen ? 'bg-teal-green/30' : 'bg-white/15 hover:bg-white/25'}`}>
              💬
            </button>
            <span className="text-white/50 text-[10px]">Chat</span>
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div className="w-80 bg-white flex flex-col border-l border-steel-grey">
          <div className="bg-white border-b border-steel-grey px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-montserrat font-bold text-sm text-ink-black">Chat with Dr. {doctorName}</p>
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
                  <p className="text-ink-black/40 text-xs">No messages yet. Start chatting with the doctor.</p>
                </div>
              </div>
            ) : (
              messages.map(m => {
                const mine = m.userId === user?.id
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${mine ? 'bg-int-blue text-white rounded-br-sm' : 'bg-white text-ink-black rounded-bl-sm shadow-sm'}`}>
                      {m.attachmentUrl && <img src={m.attachmentUrl} alt="attachment" className="max-w-full rounded-lg mb-1" />}
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

          <div className="bg-white border-t border-steel-grey p-3 flex gap-2 items-end">
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={fileUploading}
              className="w-9 h-9 rounded-xl bg-cloud-grey flex items-center justify-center text-sm text-ink-black/50 hover:bg-steel-grey transition-colors disabled:opacity-40 flex-shrink-0">
              {fileUploading ? '⏳' : '📎'}
            </button>
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message…"
              className="flex-1 h-9 px-3 rounded-xl border border-steel-grey bg-cloud-grey font-montserrat text-xs text-ink-black focus:outline-none focus:border-int-blue" />
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
