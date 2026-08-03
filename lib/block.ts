import type { SupabaseClient } from '@supabase/supabase-js'

// Calls the block-consultation-peer edge function, which bans the other
// participant from this consultation's Stream channel server-side and
// persists the relationship in `blocked_users` (P3-12 — previously the
// "Block" button only flipped local component state).
export async function blockConsultationPeer(consultationId: string, clerkToken: string): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl) throw new Error('[Block] EXPO_PUBLIC_SUPABASE_URL is not set in this build')
  const res = await fetch(`${supabaseUrl}/functions/v1/block-consultation-peer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify({ consultationId }),
  })
  if (!res.ok) throw new Error(`Block request failed: ${res.status}`)
}

// Read-back for mount: has the current user already blocked their peer on
// this consultation? RLS scopes this to the caller's own blocks only.
export async function fetchHasBlockedPeer(
  client: SupabaseClient,
  consultationId: string,
  myUserId: string,
): Promise<boolean> {
  const { data } = await client
    .from('blocked_users')
    .select('id')
    .eq('consultation_id', consultationId)
    .eq('blocker_user_id', myUserId)
    .maybeSingle()
  return !!data
}
