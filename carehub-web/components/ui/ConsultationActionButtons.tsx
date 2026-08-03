'use client'

import { Check, X } from 'lucide-react'

// Canonical Accept/Decline control used on every consultation approval
// surface (doctor overlay, phone/video ringing pages) so the affordance is
// identical everywhere: green circle + check = accept, red circle + X = decline.

type Props = {
  onAccept: () => void
  onDecline: () => void
  acceptLabel?: string
  declineLabel?: string
  disabled?: boolean
  size?: number
}

export function ConsultationActionButtons({
  onAccept,
  onDecline,
  acceptLabel = 'Accept',
  declineLabel = 'Decline',
  disabled = false,
  size = 80,
}: Props) {
  const iconSize = Math.round(size * 0.3)

  return (
    <div className="flex items-center justify-center gap-5">
      <button
        onClick={onDecline}
        disabled={disabled}
        aria-label={declineLabel}
        style={{ width: size, height: size }}
        className="rounded-full bg-danger text-white flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-danger/40 hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <X size={iconSize} />
        <span className="text-[11px] font-semibold">{declineLabel}</span>
      </button>
      <button
        onClick={onAccept}
        disabled={disabled}
        aria-label={acceptLabel}
        style={{ width: size, height: size }}
        className="rounded-full bg-success text-white flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-success/40 hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Check size={iconSize} />
        <span className="text-[11px] font-semibold">{acceptLabel}</span>
      </button>
    </div>
  )
}
