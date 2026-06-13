'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth, useUser } from '@clerk/nextjs'
import { uidFromString, fetchAgoraToken } from '@/lib/agora'
import { EndConsultationModal } from '@/components/doctor/EndConsultationModal'
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng'

interface Consultation {
  id: string
  status: string
  patient: { full_name: string } | null
}

type CallStatus = 'connecting' | 'waiting' | 'connected' | 'error'

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for patient…',
  connected: 'On Call',
  error: 'Connection failed',
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null)
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null)

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
            if (mounted) setCallStatus('connected')
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
        console.error('[Agora] Doctor phone call error:', err)
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

  function formatTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  function handleEndDone() {
    if (timerRef.current) clearInterval(timerRef.current)
    micTrackRef.current?.close()
    agoraClientRef.current?.leave()
    router.replace('/doctor/consultations')
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
    <div className="min-h-screen bg-[#070E27] flex flex-col items-center justify-between p-6 py-14">
      {showEndSheet && (
        <EndConsultationModal
          consultationId={id}
          patientName={patientName}
          elapsedSeconds={elapsed}
          onDone={handleEndDone}
          onClose={() => setShowEndSheet(false)}
        />
      )}

      {/* Patient info */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <p className={`text-xs uppercase tracking-widest font-bold mb-8 ${
          callStatus === 'connected' ? 'text-teal-green' :
          callStatus === 'error' ? 'text-danger' : 'text-white/50'
        }`}>
          {STATUS_LABEL[callStatus]}
        </p>

        {/* Pulsing avatar */}
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

        {/* Sound wave */}
        <div className="flex items-center gap-1 h-8">
          {[4, 8, 6, 14, 10, 6, 12, 8, 5, 10, 7, 4].map((h, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-teal-green/70 transition-all duration-300"
              style={{
                height: muted || callStatus !== 'connected' ? 3 : h,
                opacity: callStatus === 'connected' ? 0.7 : 0.2,
              }}
            />
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
            <button
              onClick={() => setMuted(m => !m)}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
                muted ? 'bg-care-blue' : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {muted ? '🔇' : '🎤'}
            </button>
            <span className="text-white/50 text-[10px]">{muted ? 'Unmute' : 'Mute'}</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setShowEndSheet(true)}
              className="w-20 h-20 rounded-full bg-danger flex items-center justify-center text-white text-2xl hover:bg-danger/80 transition-colors"
              style={{ boxShadow: '0 4px 20px rgba(211,47,47,0.5)' }}
            >
              📵
            </button>
            <span className="text-white/50 text-[10px]">End</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-xl text-white/40">
              🔊
            </div>
            <span className="text-white/30 text-[10px]">Speaker</span>
          </div>
        </div>
      </div>
    </div>
  )
}
