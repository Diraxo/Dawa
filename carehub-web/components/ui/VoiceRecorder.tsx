'use client'

import { useRef, useState, useCallback } from 'react'

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, durationSeconds: number) => Promise<void>
  disabled?: boolean
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'sending'

export default function VoiceRecorder({ onSend, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle')
  const [durationSec, setDurationSec] = useState(0)
  const [playProgress, setPlayProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const startRecording = useCallback(async () => {
    if (disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType })
        blobRef.current = blob
        if (audioRef.current) {
          audioRef.current.src = URL.createObjectURL(blob)
          audioRef.current.load()
        }
        stream.getTracks().forEach(t => t.stop())
        setState('recorded')
      }
      mr.start(100)
      mediaRecorderRef.current = mr
      startTimeRef.current = Date.now()
      setDurationSec(0)
      timerRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
      setState('recording')
    } catch {
      alert('Microphone access denied. Please allow microphone access to send voice notes.')
    }
  }, [disabled])

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    // Use actual elapsed time for accurate duration rather than the 1-second-interval timer
    setDurationSec(Math.round((Date.now() - startTimeRef.current) / 1000))
    mediaRecorderRef.current?.stop()
  }, [])

  const discard = useCallback(() => {
    blobRef.current = null
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
    setDurationSec(0)
    setPlayProgress(0)
    setIsPlaying(false)
    setState('idle')
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleSend = useCallback(async () => {
    if (!blobRef.current) return
    setState('sending')
    try {
      await onSend(blobRef.current, durationSec)
      discard()
    } catch {
      setState('recorded')
    }
  }, [onSend, durationSec, discard])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Voice note recorder">
      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        onEnded={() => { setIsPlaying(false); setPlayProgress(0) }}
        onTimeUpdate={e => {
          const el = e.target as HTMLAudioElement
          if (el.duration) setPlayProgress((el.currentTime / el.duration) * 100)
        }}
        className="hidden"
      />

      {state === 'idle' && (
        <button
          onClick={startRecording}
          disabled={disabled}
          className="w-10 h-10 rounded-full bg-cloud-grey hover:bg-teal-green/20 flex items-center justify-center transition-all disabled:opacity-40 group"
          title="Record voice note"
          aria-label="Start voice recording"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-ink-black/60 group-hover:text-teal-green" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        </button>
      )}

      {state === 'recording' && (
        <div className="flex items-center gap-2 bg-danger/10 border border-danger/20 rounded-2xl px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-danger animate-pulse" aria-hidden="true" />
          <span className="text-danger text-xs font-montserrat font-bold tabular-nums" aria-live="polite">{formatTime(durationSec)}</span>
          <button
            onClick={stopRecording}
            className="w-7 h-7 rounded-full bg-danger flex items-center justify-center hover:opacity-80 transition-opacity ml-1"
            title="Stop recording"
            aria-label="Stop recording"
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-white" />
          </button>
        </div>
      )}

      {state === 'recorded' && (
        <div className="flex items-center gap-2 bg-cloud-grey rounded-2xl px-3 py-1.5">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-7 h-7 rounded-full bg-teal-green flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0"
            aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
          >
            {isPlaying
              ? <span className="flex gap-0.5"><span className="w-1 h-3 bg-white rounded-sm" /><span className="w-1 h-3 bg-white rounded-sm" /></span>
              : <span className="ml-0.5 border-y-4 border-y-transparent border-l-8 border-l-white" />
            }
          </button>
          {/* Progress bar */}
          <div className="flex-1 min-w-[60px]">
            <div className="h-1 rounded-full bg-steel-grey overflow-hidden">
              <div className="h-full bg-teal-green rounded-full transition-all" style={{ width: `${playProgress}%` }} />
            </div>
          </div>
          <span className="text-ink-black/50 text-[11px] font-montserrat tabular-nums flex-shrink-0">{formatTime(durationSec)}</span>
          {/* Discard */}
          <button
            onClick={discard}
            className="w-6 h-6 rounded-full bg-steel-grey/60 flex items-center justify-center hover:bg-danger/20 hover:text-danger transition-all text-ink-black/50 flex-shrink-0"
            title="Discard recording"
            aria-label="Discard voice note"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </button>
          {/* Send */}
          <button
            onClick={handleSend}
            className="w-7 h-7 rounded-full bg-care-blue flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0"
            title="Send voice note"
            aria-label="Send voice note"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      )}

      {state === 'sending' && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="w-4 h-4 border-2 border-teal-green/30 border-t-teal-green rounded-full animate-spin" />
          <span className="text-ink-black/50 text-xs font-montserrat">Sending…</span>
        </div>
      )}
    </div>
  )
}
