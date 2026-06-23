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
  const { userId } = auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: SAFE_HEADERS,
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Doctor ID required' }), {
      status: 400,
      headers: SAFE_HEADERS,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('doctor_profiles')
    .select(
      'id, specialty, years_experience, hospital_name, bio, is_online, rating_average, total_consultations, chat_price, phone_price, video_price, users!inner(full_name, profile_photo_url)'
    )
    .eq('id', id)
    .eq('status', 'approved')
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Doctor not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  // Never expose license_number, license_doc_url, id_doc_url, bank details, or rejection_reason to patients
  const doctor = {
    id: data.id,
    fullName: (data as any).users?.full_name ?? null,
    profilePhotoUrl: (data as any).users?.profile_photo_url ?? null,
    specialty: data.specialty,
    yearsExperience: data.years_experience,
    hospitalName: data.hospital_name,
    bio: data.bio,
    isOnline: data.is_online,
    ratingAverage: data.rating_average,
    totalConsultations: data.total_consultations,
    chatPrice: data.chat_price,
    phonePrice: data.phone_price,
    videoPrice: data.video_price,
  };

  return new Response(JSON.stringify({ doctor }), { headers: SAFE_HEADERS });
}
