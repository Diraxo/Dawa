import type { SupabaseClient } from '@supabase/supabase-js'

import type { ConsultationSummaryData } from '@/components/doctor/EndConsultationSheet'

interface SubmitConsultationCompletionArgs {
  client: SupabaseClient
  consultationId: string
  data: ConsultationSummaryData
  durationMinutes: number | null
}

export type CompletionFailureStage = 'summary' | 'status'

export interface SubmitConsultationCompletionResult {
  ok: boolean
  failedAt?: CompletionFailureStage
}

// The one place chat/phone/video "End Consultation" (doctor side) writes the
// consultation_summaries row and flips consultations.status to 'completed'.
// Previously each of the 3 native doctor screens duplicated this pair of
// writes independently — any future change to ordering, columns, or error
// handling had to be applied 3 times and could silently drift between call
// types. Stream channel locking is handled server-side by a DB trigger
// (on_consultation_change → freeze-consultation-channel Edge Function) the
// instant status flips to 'completed' below — no client call needed.
export async function submitConsultationCompletion({
  client,
  consultationId,
  data,
  durationMinutes,
}: SubmitConsultationCompletionArgs): Promise<SubmitConsultationCompletionResult> {
  const { error: summaryError } = await client.from('consultation_summaries').upsert(
    {
      consultation_id: consultationId,
      chief_complaint: data.chiefComplaint,
      diagnosis: data.diagnosis,
      prescription: data.prescriptions.length > 0 ? JSON.stringify(data.prescriptions) : null,
      followup_recommendation: data.followUp || null,
      referral_needed: data.referralNeeded,
      referral_specialty: data.referralNeeded && data.referralSpecialty?.trim() ? data.referralSpecialty.trim() : null,
    },
    { onConflict: 'consultation_id' },
  )
  if (summaryError) return { ok: false, failedAt: 'summary' }

  const { error: statusError } = await client
    .from('consultations')
    .update({ status: 'completed', ended_at: new Date().toISOString(), duration_minutes: durationMinutes })
    .eq('id', consultationId)
  if (statusError) return { ok: false, failedAt: 'status' }

  return { ok: true }
}
