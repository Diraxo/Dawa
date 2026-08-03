-- Migration 103: Freeze-channel vault-secret reconciliation (P3-16)
--
-- `_call_freeze_consultation_channel()` (migration 038) authenticates to the
-- freeze-consultation-channel edge function via a vault-cached secret
-- (`carehub_service_role_key`) that is provisioned out-of-band and can
-- silently drift from the function's actual check — the same failure shape
-- as the migration-095 regression fixed in 101, just for a different
-- secret/path. `net.http_post` is fire-and-forget, so a live 403 currently
-- surfaces nowhere: a completed consultation is marked `completed` and the
-- client hides the composer, but the Stream channel is never actually frozen
-- server-side.
--
-- This adds a write-back column the edge function sets on success, plus a
-- periodic sweep that retries the freeze call for any completed consultation
-- that's been sitting unfrozen for a few minutes and logs a WARNING (visible
-- in the Postgres log explorer) so a silent vault-key mismatch is caught
-- within the same release cycle instead of never.

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS chat_frozen_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION retry_unfrozen_chat_channels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  stuck_count INT := 0;
BEGIN
  FOR rec IN
    SELECT id FROM consultations
    WHERE status = 'completed'
      AND chat_frozen_at IS NULL
      AND updated_at < now() - interval '3 minutes'
    LIMIT 50
  LOOP
    stuck_count := stuck_count + 1;
    PERFORM _call_freeze_consultation_channel(rec.id);
  END LOOP;

  IF stuck_count > 0 THEN
    RAISE WARNING '[Dawa] retry_unfrozen_chat_channels: retried freeze for % consultation(s) still unfrozen after 3+ minutes — if this recurs, check carehub_service_role_key (vault) against the live SUPABASE_SERVICE_ROLE_KEY', stuck_count;
  END IF;
END;
$$;

SELECT cron.schedule(
  'retry-unfrozen-chat-channels',
  '*/5 * * * *',
  'SELECT public.retry_unfrozen_chat_channels();'
);
