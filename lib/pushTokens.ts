// lib/pushTokens.ts
//
// Push/call tokens (Expo push_token, Android fcm_token, iOS voip_token) are
// stored per-user-row but actually identify a device+app-install, not an
// account. Two situations create "ghost" cross-account delivery if not
// handled explicitly:
//
//  1. Logout: the signed-out user's row keeps whatever token was last
//     written — any event addressed to that account still reaches this
//     physical device even though a different account may now be signed in.
//  2. Login/re-registration: the same physical token can already be sitting
//     on a *different* user's row (left over from a previous account on
//     this device, or an old session that never called clearPushTokens).
//     Writing the token to the new user's row without also clearing it from
//     wherever else it lives leaves both rows pointing at this device.
//
// Both call sites in this file close those gaps.

import { supabase } from './supabase'
import { logger } from './logger'

const TOKEN_COLUMNS = ['push_token', 'fcm_token', 'voip_token'] as const

/**
 * Call on sign-out, before Clerk's signOut() resolves, so the outgoing
 * account's row no longer references this device's tokens.
 */
export async function clearPushTokens(clerkUserId: string): Promise<void> {
  if (!clerkUserId) return
  try {
    const { error } = await supabase
      .from('users')
      .update({ push_token: null, fcm_token: null, voip_token: null })
      .eq('clerk_id', clerkUserId)
    if (error) logger.warn('[PushTokens] Failed to clear tokens on logout:', error.message)
  } catch (e) {
    logger.warn('[PushTokens] clearPushTokens threw:', e)
  }
}

/**
 * Call before persisting a freshly-obtained token value to the current
 * user's row. Strips that exact token value off any *other* user row first,
 * so a stale association from a previous account on this device (including
 * ones that predate this fix, or a logout that skipped clearPushTokens for
 * any reason — force-quit, crash) can never keep receiving pushes meant for
 * someone else.
 *
 * Goes through the reclaim_push_token RPC (migration 087), not a direct
 * `.update()` — the target rows belong to a *different* user than the
 * caller, and the users_update_own RLS policy only ever allows a row to be
 * updated by its own clerk_id (or an admin). A direct client-side update
 * here would match zero rows on every call, silently, with no error.
 */
export async function reclaimTokenFromOtherUsers(
  column: (typeof TOKEN_COLUMNS)[number],
  tokenValue: string,
  currentClerkUserId: string,
): Promise<void> {
  if (!tokenValue || !currentClerkUserId) return
  try {
    const { error } = await supabase.rpc('reclaim_push_token', {
      p_column: column,
      p_token: tokenValue,
      p_current_clerk_id: currentClerkUserId,
    })
    if (error) logger.warn(`[PushTokens] Failed to reclaim ${column} from other users:`, error.message)
    else logger.log(`[PushTokens] Reclaimed ${column} from other users (if any held it)`)
  } catch (e) {
    logger.warn(`[PushTokens] reclaimTokenFromOtherUsers(${column}) threw:`, e)
  }
}
