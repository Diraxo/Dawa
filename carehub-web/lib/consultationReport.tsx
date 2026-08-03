import type { SupabaseClient } from '@supabase/supabase-js'
import { pdf } from '@react-pdf/renderer'
import type { Database } from '@/types/database'
import { ConsultationReportDocument, type ConsultationReportData } from '@/components/reports/ConsultationReportDocument'

const BUCKET = 'consultation-reports'

function reportPath(consultationId: string) {
  return `${consultationId}/report.pdf`
}

export async function generateAndUploadReport(
  client: SupabaseClient<Database>,
  consultationId: string,
  data: ConsultationReportData,
): Promise<string> {
  const blob = await pdf(
    <ConsultationReportDocument data={data} logoUrl={typeof window !== 'undefined' ? `${window.location.origin}/logo-white.png` : undefined} />,
  ).toBlob()

  const path = reportPath(consultationId)
  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw uploadError

  const { error: updateError } = await client
    .from('consultation_summaries')
    .update({ report_pdf_path: path })
    .eq('consultation_id', consultationId)
  if (updateError) throw updateError

  return path
}

export async function getReportSignedUrl(client: SupabaseClient<Database>, path: string): Promise<string | null> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}
