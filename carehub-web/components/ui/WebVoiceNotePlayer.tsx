'use client'

import { useRef, useState, useEffect } from 'react'

interface WebVoiceNotePlayerProps {
  src: string
  durationSec?: number
  isMine?: boolean
}

export function WebVoiceNotePlayer({ src, durationSec = 0, isMine }: WebVoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(durationSec)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    audio.preload = 'metadata'
    audio.src = src

    const onEnded = () => {
      setIsPlaying(false)
      setProgress(0)
      setCurrentTime(0)
    }
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setProgress((audio.currentTime / audio.duration) * 100)
      }
    }
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(Math.round(audio.duration))
      }
    }

    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)

    return () => {
      audio.pause()
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [src])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !audio.duration || !isFinite(audio.duration)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * audio.duration
    setProgress(pct * 100)
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`
  const displayTime = isPlaying ? fmt(currentTime) : fmt(duration)

  const accent = isMine ? 'white' : '#0D9488'
  const trackBg = isMine ? 'rgba(255,255,255,0.25)' : '#D1D5DB'
  const containerBg = isMine ? 'rgba(255,255,255,0.12)' : '#F3F4F6'
  const iconColor = isMine ? '#1D7A8A' : 'white'

  return (
    <div
      className="flex items-center gap-2"
      style={{ background: containerBg, borderRadius: 16, padding: '6px 10px', minWidth: 160 }}
    >
      <button
        onClick={toggle}
        className="flex-shrink-0 flex items-center justify-center rounded-full"
        style={{ width: 28, height: 28, background: accent }}
        aria-label={isPlaying ? 'Pause' : 'Play voice note'}
      >
        {isPlaying ? (
          <span className="flex gap-[3px]">
            <span style={{ width: 3, height: 11, borderRadius: 2, background: iconColor }} />
            <span style={{ width: 3, height: 11, borderRadius: 2, background: iconColor }} />
          </span>
        ) : (
          <span
            style={{
              marginLeft: 2,
              width: 0,
              height: 0,
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderLeft: `9px solid ${iconColor}`,
            }}
          />
        )}
      </button>

      <div
        className="flex-1 h-1 rounded-full overflow-hidden cursor-pointer"
        style={{ background: trackBg }}
        onClick={handleSeek}
        title="Seek"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progress}%`, background: accent }}
        />
      </div>

      <span
        className="text-[11px] tabular-nums flex-shrink-0"
        style={{ color: isMine ? 'rgba(255,255,255,0.75)' : '#6B7280' }}
      >
        {displayTime}
      </span>
    </div>
  )
}
