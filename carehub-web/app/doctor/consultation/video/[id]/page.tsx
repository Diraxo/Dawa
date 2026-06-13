'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { uidFromString, fetchAgoraToken } from '@/lib/agora'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, ICameraVideoTrack } from 'agora-rtc-sdk-ng'

interface Consultation {
  id: string
  status: string
  patient: { full_name: string } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'error'

export default function DoctorVideoConsultationPage() {
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
  const [showEndSheet, setShowEndSheet] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)
  const camTrackRef = useRef<ICameraVideoTrack | null>(null)
  const remoteVideoRef = useRef<HTMLDivElement>(null)
  const localVideoRef = useRef<HTMLDivElement>(null)

  // Load consultation
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('consultations')
        .select('id, status, patient:users!patient_id(full_name)')
        .eq('id', id)
        .single()
      setConsultation(data as unknown as Consultation)
      setLoading(false)
    }
    load()
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id])

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
        console.error('[Agora] Doctor video call error:', err)
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

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  function handleEndDone() {
    if (timerRef.current) clearInterval(timerRef.current)
    micTrackRef.current?.close()
    camTrackRef.current?.close()
    agoraClientRef.current?.leave()
    router.replace('/doctor/consultations')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-white/40 text-sm">Connecting…</div>
      </div>
    )
  }

  const patientName = consultation?.patient?.full_name ?? 'Patient'

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col relative">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id}
          patientName={patientName}
          elapsedSeconds={elapsed}
          onDone={handleEndDone}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Remote video (patient — full screen) */}
      <div className="flex-1 relative bg-[#0D1A3A]">
        <div ref={remoteVideoRef} className="absolute inset-0" />

        {/* Placeholder when no remote video */}
        {callStatus !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-white/20 text-5xl mx-auto mb-4">
                👤
              </div>
              <p className="text-white/50 text-base font-semibold">{patientName}</p>
              <p className="text-white/30 text-sm mt-1">
                {callStatus === 'connecting' ? 'Connecting…' :
                 callStatus === 'error' ? 'Connection failed' : 'Waiting for patient…'}
              </p>
            </div>
          </div>
        )}

        {/* Timer + LIVE */}
        <div className="absolute top-6 left-0 right-0 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            <span className="text-white text-xs font-bold tracking-wider">LIVE</span>
          </div>
          <div className="bg-black/50 rounded-full px-4 py-1.5">
            <span className="text-white font-mono text-sm">{formatTime(elapsed)}</span>
          </div>
        </div>

        {/* Self view — top right */}
        <div className="absolute top-16 right-4 w-24 h-32 rounded-2xl overflow-hidden border-2 border-white/20 shadow-lg bg-[#1F2937]">
          <div ref={localVideoRef} className="absolute inset-0" />
          {camOff && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/40">
              <span className="text-2xl">📷</span>
              <span className="text-[9px]">Camera off</span>
            </div>
          )}
          <span className="absolute bottom-1 left-0 right-0 text-center text-white/60 text-[9px] z-10">You</span>
        </div>

        {/* Screen share badge */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <span className="text-white/25 text-xs italic">Screen share — coming soon</span>
        </div>
      </div>

      {/* Controls bar */}
      <div className="px-6 py-5 bg-black/85 flex items-center justify-center gap-6">
        {/* Mute */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setMuted(m => !m)}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
              muted ? 'bg-care-blue' : 'bg-white/15 hover:bg-white/25'
            }`}
          >
            {muted ? '🔇' : '🎤'}
          </button>
          <span className="text-white/50 text-[10px]">{muted ? 'Unmute' : 'Mute'}</span>
        </div>

        {/* Camera */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setCamOff(c => !c)}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
              camOff ? 'bg-care-blue' : 'bg-white/15 hover:bg-white/25'
            }`}
          >
            {camOff ? '📷' : '🎥'}
          </button>
          <span className="text-white/50 text-[10px]">{camOff ? 'Cam On' : 'Cam Off'}</span>
        </div>

        {/* End call */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setShowEndSheet(true)}
            className="w-16 h-16 rounded-full bg-danger flex items-center justify-center text-white text-2xl hover:bg-danger/80 transition-colors"
            style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}
          >
            📵
          </button>
          <span className="text-white/50 text-[10px]">End</span>
        </div>

        {/* Share screen placeholder */}
        <div className="flex flex-col items-center gap-1">
          <button
            disabled
            className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center text-xl opacity-40 cursor-not-allowed"
            title="Coming soon"
          >
            🖥️
          </button>
          <span className="text-white/30 text-[10px]">Share</span>
        </div>
      </div>
    </div>
  )
}
