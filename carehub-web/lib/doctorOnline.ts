import type { getAuthClient } from '@/lib/supabase'

/**
 * Single write path for `doctor_profiles.is_online`, shared by every page
 * with an online/offline toggle (Home, Schedule — previously two
 * near-identical inline `.update()` calls with the same payload shape).
 */
export async function writeDoctorOnlineStatus(
  client: ReturnType<typeof getAuthClient>,
  profileId: string,
  newStatus: boolean
) {
  return client
    .from('doctor_profiles')
    .update({ is_online: newStatus })
    .eq('id', profileId)
}
