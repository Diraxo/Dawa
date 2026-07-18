'use client'

import type { ReactNode } from 'react'
import { Lock, User, X, Phone, Video } from 'lucide-react'
import { formatCallDuration } from '@/lib/callDuration'

interface ConsultationInfoPanelProps {
  open: boolean
  onClose: () => void
  consultationId: string
  consultationType: 'phone' | 'video'
  counterpartLabel: string // "Doctor" | "Patient"
  counterpartName: string
  counterpartPhotoUrl?: string | null
  startedAt: string | null
  elapsedSeconds: number
  networkQuality: number // Agora 0-6 scale — 0-2 good, 3-4 fair, 5-6 poor
}

function formatStartedAt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function qualityMeta(quality: number) {
  if (quality === 0) return { label: 'Measuring…', bars: 3, color: '#94A3B8' }
  if (quality <= 2) return { label: 'Excellent', bars: 3, color: '#4ADE80' }
  if (quality <= 4) return { label: 'Fair', bars: 2, color: '#FBBF24' }
  return { label: 'Poor', bars: 1, color: '#F87171' }
}

export function ConsultationInfoPanel({
  open, onClose, consultationId, consultationType, counterpartLabel,
  counterpartName, counterpartPhotoUrl, startedAt, elapsedSeconds, networkQuality,
}: ConsultationInfoPanelProps) {
  if (!open) return null

  const q = qualityMeta(networkQuality)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-[#0D1530] text-white shadow-2xl flex flex-col
          inset-x-0 bottom-0 max-h-[80vh] rounded-t-3xl
          md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:top-0 md:h-full md:w-96 md:max-h-none md:rounded-t-none md:rounded-l-3xl"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 className="font-montserrat font-bold text-base">Consultation Info</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-interactive flex items-center justify-center">
              {counterpartPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={counterpartPhotoUrl} alt={counterpartName} className="w-full h-full object-cover" />
              ) : (
                <User size={32} className="text-white/70" />
              )}
            </div>
            <div>
              <p className="font-montserrat font-bold text-lg">{counterpartName}</p>
              <p className="text-white/50 text-xs">{counterpartLabel}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] divide-y divide-white/[0.08]">
            <InfoRow label="Consultation ID" value={consultationId.slice(0, 8).toUpperCase()} mono />
            <InfoRow
              label="Type"
              value={
                <span className="inline-flex items-center gap-1">
                  {consultationType === 'phone' ? <Phone size={12} /> : <Video size={12} />}
                  {consultationType === 'phone' ? 'Phone' : 'Video'}
                </span>
              }
            />
            <InfoRow label="Started" value={formatStartedAt(startedAt)} />
            <InfoRow label="Duration" value={formatCallDuration(elapsedSeconds)} mono />
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-white/50">Connection</span>
              <div className="flex items-center gap-2">
                <div className="flex items-end gap-0.5" style={{ height: 14 }}>
                  {[1, 2, 3].map(b => (
                    <div key={b} style={{ width: 3, height: 4 + b * 3, borderRadius: 1.5, backgroundColor: b <= q.bars ? q.color : 'rgba(255,255,255,0.15)' }} />
                  ))}
                </div>
                <span className="text-xs font-semibold" style={{ color: q.color }}>{q.label}</span>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 self-start bg-teal-green/10 border border-teal-green/25 text-teal-green rounded-full px-3 py-1.5 text-xs font-semibold">
            <Lock size={12} />
            End-to-end encrypted
          </div>
        </div>
      </div>
    </>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-white/50">{label}</span>
      <span className={`text-xs font-semibold ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
