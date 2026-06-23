import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const SAFE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: SAFE_HEADERS,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('doctor_profiles')
    .select(
      'id, specialty, years_experience, hospital_name, bio, is_online, rating_average, total_consultations, chat_price, phone_price, video_price, users!inner(full_name, profile_photo_url)'
    )
    .eq('status', 'approved')
    .order('rating_average', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch doctors' }), {
      status: 500,
      headers: SAFE_HEADERS,
    });
  }

  // Strip private fields — never expose license numbers, documents, bank details, or earnings
  const doctors = (data ?? []).map((d: any) => ({
    id: d.id,
    fullName: d.users?.full_name ?? null,
    profilePhotoUrl: d.users?.profile_photo_url ?? null,
    specialty: d.specialty,
    yearsExperience: d.years_experience,
    hospitalName: d.hospital_name,
    bio: d.bio,
    isOnline: d.is_online,
    ratingAverage: d.rating_average,
    totalConsultations: d.total_consultations,
    chatPrice: d.chat_price,
    phonePrice: d.phone_price,
    videoPrice: d.video_price,
  }));

  return new Response(JSON.stringify({ doctors }), { headers: SAFE_HEADERS });
}
