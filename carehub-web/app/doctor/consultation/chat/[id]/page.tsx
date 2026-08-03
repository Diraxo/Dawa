'use client'

import { useParams } from 'next/navigation'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'

export default function DoctorChatConsultationPage() {
  const { id } = useParams<{ id: string }>()
  return <ConsultationChatThread consultationId={id as string} role="doctor" variant="page" />
}
