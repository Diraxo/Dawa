'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface Props {
  open: boolean
  onViewSummary: () => void
  onClose: () => void
}

// The one completion dialog shown to a patient the instant a consultation
// (chat, phone, or video — any booking type) flips to 'completed'. Replaces
// the previous per-screen ad hoc "Call Ended" full-page states so all three
// consultation types present identically styled, on-brand messaging.
export function ConsultationCompletedModal({ open, onViewSummary, onClose }: Props) {
  const [mounted, setMounted] = useState(open)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const t = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(t)
    }
    setEntered(false)
    const t = setTimeout(() => setMounted(false), 150)
    return () => clearTimeout(t)
  }, [open])

  if (!mounted) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="consultation-completed-title"
      aria-describedby="consultation-completed-message"
      className={`fixed inset-0 z-[100] flex items-center justify-center px-6 transition-opacity duration-150 ${entered ? 'opacity-100' : 'opacity-0'}`}
      style={{ backgroundColor: 'rgba(17,24,39,0.55)' }}
    >
      <div
        className={`w-full max-w-sm bg-white rounded-3xl px-6 py-8 flex flex-col items-center text-center shadow-2xl transition-all duration-150 ${entered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        <div className="w-16 h-16 rounded-full bg-[#F0FDFB] flex items-center justify-center mb-4">
          <CheckCircle2 className="w-9 h-9 text-teal-green" />
        </div>

        <h2 id="consultation-completed-title" className="font-montserrat font-bold text-xl text-ink-black mb-2">
          Consultation Completed
        </h2>
        <p id="consultation-completed-message" className="text-sm text-ink-black/60 leading-relaxed mb-6">
          Your doctor has completed your consultation.
          <br /><br />
          Your consultation summary is now available.
        </p>

        <button onClick={onViewSummary} className="btn-primary w-full h-12 rounded-2xl text-sm mb-2">
          View Summary
        </button>
        <button onClick={onClose} className="w-full h-11 text-sm font-semibold text-ink-black/50 hover:text-ink-black/70 transition-colors">
          Close
        </button>
      </div>
    </div>
  )
}
