import { StreamChat } from 'stream-chat'

export const streamClient = StreamChat.getInstance(
  process.env.EXPO_PUBLIC_STREAM_API_KEY!
)

export async function createConsultationChannel(
  consultationId: string,
  patientId: string,
  doctorId: string,
  meta: {
    doctorName: string
    doctorSubtitle: string
    doctorPhotoUrl?: string | null
  }
) {
  const channel = streamClient.channel('messaging', consultationId, {
    members: [patientId, doctorId],
    ...({
      doctorId,
      doctorName: meta.doctorName,
      doctorSubtitle: meta.doctorSubtitle,
      doctorPhotoUrl: meta.doctorPhotoUrl ?? null,
      consultationStatus: 'active',
    } as object),
  })
  await channel.create()
  return channel
}

export async function markConsultationCompleted(channelId: string) {
  const channel = streamClient.channel('messaging', channelId)
  await channel.updatePartial({ set: { consultationStatus: 'completed' } as object })
}
