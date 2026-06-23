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
    .from('users')
    .select('id, email, full_name, role, country, language, profile_photo_url')
    .eq('clerk_id', userId)
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  // Return only safe fields — never expose clerk_id, phone, or raw tokens
  return new Response(
    JSON.stringify({
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role,
      country: data.country,
      language: data.language,
      profilePhotoUrl: data.profile_photo_url,
    }),
    { headers: SAFE_HEADERS }
  );
}
