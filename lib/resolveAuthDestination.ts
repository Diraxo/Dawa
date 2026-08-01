import type { SupabaseClient } from '@supabase/supabase-js'

export type AuthDestination = {
  role: 'patient' | 'doctor' | null
  route: string
}

// Single source of truth for "where does this authenticated user belong".
// Every entry point that establishes a Clerk session (email sign-in, Google,
// Apple, OAuth callback, password reset) must route through this so a
// pending/rejected/suspended doctor can never land on the doctor dashboard
// just because one specific screen forgot to check doctor_profiles.status.
// Looks up by Clerk id (`clerk_id`), never by email — email-keyed lookups
// are what caused existing users to be misrouted to Role Selection.
// Throws on lookup failure so callers can retry instead of silently
// defaulting to Role Selection.
export async function resolveAuthDestination(
  client: SupabaseClient,
  clerkId: string,
): Promise<AuthDestination> {
  const { data: userData, error } = await client
    .from('users')
    .select('id, role')
    .eq('clerk_id', clerkId)
    .single()
  if (error) throw error

  if (userData?.role === 'patient') {
    return { role: 'patient', route: '/(patient)/(tabs)/home' }
  }

  if (userData?.role === 'doctor') {
    const { data: dp, error: dpError } = await client
      .from('doctor_profiles')
      .select('status')
      .eq('user_id', userData.id)
      .single()
    // PGRST116 = no matching row, i.e. the doctor hasn't finished
    // registration yet — a legitimate case, not a lookup failure to retry.
    if (dpError && dpError.code !== 'PGRST116') throw dpError

    const status = dp?.status
    if (status === 'approved') {
      return { role: 'doctor', route: '/(doctor)/(tabs)/home' }
    }
    if (status === 'pending' || status === 'rejected' || status === 'suspended') {
      return { role: 'doctor', route: '/(doctor)/registration/under-review' }
    }
    return { role: 'doctor', route: '/(doctor)/registration/step-1' }
  }

  // No row, or a row with no recognised role — genuinely new signup.
  return { role: null, route: '/(auth)/role' }
}
