import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const SAFE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { userId: clerkId } = auth();
  if (!clerkId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: SAFE_HEADERS,
    });
  }

  const { data: consultation } = await supabaseAdmin
    .from('consultations')
    .select(
      'id, patient_id, doctor_id, type, status, scheduled_at, started_at, ended_at, duration_minutes, patient_amount, payment_status, created_at'
    )
    .eq('id', params.id)
    .single();

  // Return 404 for both not-found and unauthorized so attackers cannot
  // probe whether a consultation ID exists.
  if (!consultation) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  const { data: currentUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single();

  const isPatient = consultation.patient_id === currentUser?.id;
  const isDoctor = consultation.doctor_id === currentUser?.id;

  if (!isPatient && !isDoctor) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  return new Response(
    JSON.stringify({
      id: consultation.id,
      type: consultation.type,
      status: consultation.status,
      scheduledAt: consultation.scheduled_at,
      startedAt: consultation.started_at,
      endedAt: consultation.ended_at,
      durationMinutes: consultation.duration_minutes,
      amount: consultation.patient_amount,
      paymentStatus: consultation.payment_status,
      createdAt: consultation.created_at,
      ...(isPatient
        ? { doctorId: consultation.doctor_id }
        : { patientId: consultation.patient_id }),
    }),
    { headers: SAFE_HEADERS }
  );
}
