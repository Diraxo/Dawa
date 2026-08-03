-- Migration 023: doctor_missed status + heartbeat system + stale consultation cleanup
--
-- Adds:
--   1. 'doctor_missed' status — when the doctor doesn't respond within the countdown
--   2. last_heartbeat_at column — updated by active consultation screens
--   3. mark_doctor_missed_consultations() — pg_cron cleanup when no heartbeat
--   4. mark_stale_active_consultations() — mark abandoned in-progress sessions

-- ── 1. Add new consultation status values ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'consultation_status'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'consultation_status' AND e.enumlabel = 'doctor_missed'
    ) THEN
      ALTER TYPE consultation_status ADD VALUE 'doctor_missed';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'consultation_status' AND e.enumlabel = 'ended_abnormally'
    ) THEN
      ALTER TYPE consultation_status ADD VALUE 'ended_abnormally';
    END IF;
  END IF;
END $$;

-- ── 2. Add heartbeat column ───────────────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- Index for the stale-session cleanup query
CREATE INDEX IF NOT EXISTS idx_consultations_heartbeat
  ON public.consultations (status, last_heartbeat_at)
  WHERE status IN ('accepted', 'in_progress', 'active');

-- ── 3. Mark doctor_missed when doctor has not responded within the timeout ────
-- Default timeout: 120 seconds (2 minutes). Configurable via app_config.
-- Runs every minute — first fires ~60 s after the consultation enters
-- waiting_for_doctor (i.e., it will catch a 60-second frontend countdown expiry
-- even if the client update fails, acting as a server-side safety net).
CREATE OR REPLACE FUNCTION mark_doctor_missed_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_timeout_seconds int := 120;
BEGIN
  -- Allow override via app_config
  BEGIN
    SELECT (value::text)::int INTO v_timeout_seconds
    FROM public.app_config
    WHERE key = 'waiting_room_timeout_seconds'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_timeout_seconds := 120;
  END;

  UPDATE public.consultations
  SET
    status     = 'doctor_missed',
    updated_at = NOW()
  WHERE
    status         = 'waiting_for_doctor'
    AND payment_status = 'paid'
    AND waiting_started_at IS NOT NULL
    AND waiting_started_at < NOW() - (v_timeout_seconds || ' seconds')::interval;
END;
$$;

-- ── 4. Mark stale active consultations as ended_abnormally ───────────────────
-- A session without a heartbeat for 10 minutes is considered dead.
-- This prevents zombie sessions blocking doctor availability indefinitely.
CREATE OR REPLACE FUNCTION mark_stale_active_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.consultations
  SET
    status     = 'ended_abnormally',
    ended_at   = NOW(),
    updated_at = NOW()
  WHERE
    status IN ('accepted', 'in_progress', 'active')
    AND (
      -- Has a heartbeat that's too old
      (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - INTERVAL '10 minutes')
      -- OR was accepted more than 8 hours ago with no heartbeat ever sent
      OR (last_heartbeat_at IS NULL AND started_at < NOW() - INTERVAL '8 hours')
    );
END;
$$;

-- ── 5. Schedule pg_cron jobs ─────────────────────────────────────────────────
SELECT cron.schedule(
  'mark-doctor-missed',
  '* * * * *',
  'SELECT mark_doctor_missed_consultations()'
);

SELECT cron.schedule(
  'mark-stale-consultations',
  '*/5 * * * *',
  'SELECT mark_stale_active_consultations()'
);

-- ── 6. Ensure ended_abnormally and doctor_missed are in Realtime publication ──
-- (consultations table was already added in migration 022)
-- No additional action needed.
