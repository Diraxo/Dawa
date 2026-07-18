'use client'

import Link from 'next/link'
import { MessageCircle, Phone, Video, X, ClipboardList } from 'lucide-react'
import { stripDrPrefix } from '@/lib/utils'
import { SLOT_DURATION_MINS } from '@/lib/slotGeneration'

export interface AppointmentDetails {
  id: string
  type: string
  status: string
  patientName: string
  patientPhotoUrl?: string | null
  whenLabel: string
  /** Actual elapsed minutes for a completed call; falls back to the standard slot length. */
  durationMinutes?: number
}

const TYPE_ICONS: Record<string, typeof MessageCircle> = { chat: MessageCircle, phone: Phone, video: Video }
const JOINABLE_STATUSES = new Set(['active', 'accepted', 'in_progress'])

// Lightweight, shared across the doctor's schedule surfaces (Today's
// Schedule, Upcoming Appointments, This Week, Consultations) so tapping a
// card always opens the same patient/appointment detail view instead of
// doing nothing.
export function AppointmentDetailsModal({ appt, onClose }: { appt: AppointmentDetails | null; onClose: () => void }) {
  if (!appt) return null
  const Icon = TYPE_ICONS[appt.type] ?? ClipboardList
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0">
              {appt.patientPhotoUrl ? (
                <img src={appt.patientPhotoUrl} alt={appt.patientName} className="w-14 h-14 object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gradient-hero flex items-center justify-center text-white font-black text-lg">
                  {stripDrPrefix(appt.patientName).charAt(0) || '?'}
                </div>
              )}
            </div>
            <div>
              <p className="font-montserrat font-bold text-base text-ink-black">{appt.patientName}</p>
              <p className="text-ink-black/50 text-xs capitalize">{appt.status.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-black/40 hover:text-ink-black">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-2 text-sm mb-5">
          <div className="flex items-center gap-2 text-ink-black/70">
            <Icon size={16} className="text-int-blue" />
            <span className="capitalize">{appt.type} consultation</span>
          </div>
          <div className="text-ink-black/70">{appt.whenLabel}</div>
          <div className="text-ink-black/70">{appt.durationMinutes ?? SLOT_DURATION_MINS} min</div>
        </div>

        {JOINABLE_STATUSES.has(appt.status) && (
          <Link href={`/doctor/consultation/${appt.type}/${appt.id}`} className="btn-primary w-full h-10 flex items-center justify-center text-sm rounded-xl">
            Join Call
          </Link>
        )}
        {appt.status === 'completed' && (
          <Link href={`/doctor/consultation/summary/${appt.id}`} className="btn-outline w-full h-10 flex items-center justify-center text-sm rounded-xl">
            View Summary
          </Link>
        )}
      </div>
    </div>
  )
}
