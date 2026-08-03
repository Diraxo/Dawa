import { create } from 'zustand'

type ConsultationType = 'chat' | 'phone' | 'video'

interface ConsultationState {
  consultationId: string | null
  consultationType: ConsultationType | null
  channelName: string | null
  agoraToken: string | null
  patientId: string | null
  doctorProfileId: string | null

  setConsultation: (data: Partial<Omit<ConsultationState, 'setConsultation' | 'clearAfterConsultation'>>) => void
  clearAfterConsultation: () => void
}

// Not persisted — sensitive tokens must not survive app restarts.
export const useConsultationStore = create<ConsultationState>((set) => ({
  consultationId: null,
  consultationType: null,
  channelName: null,
  agoraToken: null,
  patientId: null,
  doctorProfileId: null,

  setConsultation: (data) => set(data),

  clearAfterConsultation: () =>
    set({
      consultationId: null,
      consultationType: null,
      channelName: null,
      agoraToken: null,
      patientId: null,
      doctorProfileId: null,
    }),
}))
