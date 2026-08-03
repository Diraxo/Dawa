import { create } from 'zustand'

export interface QueuedRequest {
  id: string
  patientId: string
  patientName: string
  waitingStartedAt: string
}

interface DoctorQueueState {
  // Every consultation currently waiting_for_doctor/paid for this doctor,
  // ordered oldest-first. Populated solely by useIncomingConsultationAlert
  // (mounted once at app/(doctor)/_layout.tsx, so it keeps updating no
  // matter which tab/screen is on screen) — Home's queue widget just reads
  // this instead of running its own duplicate fetch/realtime logic.
  queueList: QueuedRequest[]
  setQueueList: (list: QueuedRequest[]) => void
}

export const useDoctorQueueStore = create<DoctorQueueState>()((set) => ({
  queueList: [],
  setQueueList: (queueList) => set({ queueList }),
}))
