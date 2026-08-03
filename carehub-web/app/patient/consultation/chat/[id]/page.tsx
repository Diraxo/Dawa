'use client'

import { useParams } from 'next/navigation'
import { ConsultationChatThread } from '@/components/chat/ConsultationChatThread'

export default function ChatConsultationPage() {
  const { id } = useParams<{ id: string }>()
  return <ConsultationChatThread consultationId={id as string} role="patient" variant="page" />
}
