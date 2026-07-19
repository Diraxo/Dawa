-- Migration 087: RPC to reclaim a push/call token from other user rows
--
-- lib/pushTokens.ts's reclaimTokenFromOtherUsers() (added alongside migration
-- 086) does `supabase.from('users').update({ [column]: null }).eq(column,
-- token).neq('clerk_id', currentClerkUserId)` directly from the client. That
-- update targets OTHER users' rows, but the existing users_update_own RLS
-- policy (migration 002) only allows a row to be updated when
-- `clerk_id = auth.jwt()->>'sub'` (or admin). For a non-admin caller,
-- `clerk_id <> currentClerkUserId` and `clerk_id = auth.jwt()->>'sub'` can
-- never both be true, so RLS silently matches zero rows on every call —
-- no error is raised, the update just does nothing. This is the real reason
-- "wrong device still receives notifications" (stale token on another
-- user's row) survived past the migration-086/reclaimTokenFromOtherUsers fix:
-- the fix was calling an update RLS was always going to block.
--
-- Fix: do the cross-row null-out server-side via a SECURITY DEFINER function,
-- narrowly scoped to exactly the three token columns and to clearing (never
-- reading or setting a non-null value on someone else's row).

CREATE OR REPLACE FUNCTION public.reclaim_push_token(
  p_column TEXT,
  p_token TEXT,
  p_current_clerk_id TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_column NOT IN ('push_token', 'fcm_token', 'voip_token') THEN
    RAISE EXCEPTION 'reclaim_push_token: invalid column %', p_column;
  END IF;
  IF p_token IS NULL OR p_token = '' OR p_current_clerk_id IS NULL OR p_current_clerk_id = '' THEN
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.users SET %I = NULL WHERE %I = $1 AND clerk_id <> $2',
    p_column, p_column
  ) USING p_token, p_current_clerk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_push_token(TEXT, TEXT, TEXT) TO authenticated;
