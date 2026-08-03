import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const SAFE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET() {
  const { userId: clerkId } = auth();
  if (!clerkId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: SAFE_HEADERS,
    });
  }

  // Resolve clerk_id → internal user id
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('clerk_id', clerkId)
    .single();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  // Filter by ownership — patients see their own, doctors see their own
  const ownershipFilter =
    user.role === 'doctor' ? 'doctor_id' : 'patient_id';

  const { data, error } = await supabaseAdmin
    .from('consultations')
    .select(
      'id, type, status, scheduled_at, started_at, ended_at, duration_minutes, patient_amount, payment_status, created_at, doctor_id, patient_id'
    )
    .eq(ownershipFilter, user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch consultations' }), {
      status: 500,
      headers: SAFE_HEADERS,
    });
  }

  // Strip the other party's internal ID before sending — never expose platform_amount or doctor_amount to patients
  const consultations = (data ?? []).map((c: any) => ({
    id: c.id,
    type: c.type,
    status: c.status,
    scheduledAt: c.scheduled_at,
    startedAt: c.started_at,
    endedAt: c.ended_at,
    durationMinutes: c.duration_minutes,
    amount: c.patient_amount,
    paymentStatus: c.payment_status,
    createdAt: c.created_at,
    // Expose only the relevant party ID for linking to doctor/patient profile
    ...(user.role === 'patient' ? { doctorId: c.doctor_id } : { patientId: c.patient_id }),
  }));

  return new Response(JSON.stringify({ consultations }), { headers: SAFE_HEADERS });
}
