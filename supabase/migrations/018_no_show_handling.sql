-- Migration 018: No-show handling for consultations
-- Marks consultations as 'no_show' when patient doesn't join within 30 minutes
-- Adds pg_cron job to run every 5 minutes

-- Add 'no_show' and 'missed' to valid status values if not already present
-- (these might already be used from the app code — ensure the column allows them)
DO $$
BEGIN
  -- Check if consultation status is an enum and add values if needed
  -- If it's a text column this is a no-op
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'consultation_status'
  ) THEN
    -- Only add if not already present
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'consultation_status' AND e.enumlabel = 'no_show') THEN
      ALTER TYPE consultation_status ADD VALUE 'no_show';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'consultation_status' AND e.enumlabel = 'missed') THEN
      ALTER TYPE consultation_status ADD VALUE 'missed';
    END IF;
  END IF;
END $$;

-- Function: mark consultations as no_show when patient doesn't join on time
CREATE OR REPLACE FUNCTION mark_no_show_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE consultations
  SET
    status = 'no_show',
    updated_at = NOW()
  WHERE
    status = 'waiting_for_doctor'
    AND payment_status = 'paid'
    AND scheduled_at IS NOT NULL
    -- More than 30 minutes past the scheduled time
    AND scheduled_at < NOW() - INTERVAL '30 minutes'
    -- Didn't start within the window
    AND (started_at IS NULL OR started_at < NOW() - INTERVAL '30 minutes');
END;
$$;

-- Function: mark consultations as no_show when doctor accepts but patient never joins (phone/video ringing state)
-- Uses waiting_started_at — if accepted more than 5 minutes ago and status is still 'accepted'
-- (patient received the push but never answered)
CREATE OR REPLACE FUNCTION mark_missed_calls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE consultations
  SET
    status = 'missed',
    updated_at = NOW()
  WHERE
    status = 'accepted'
    AND type IN ('phone', 'video')
    AND started_at IS NOT NULL
    -- Doctor accepted more than 5 minutes ago and patient never joined
    AND started_at < NOW() - INTERVAL '5 minutes';
END;
$$;

-- Schedule no-show checks with pg_cron (runs every 5 minutes)
-- Note: pg_cron must be enabled on the Supabase project (it is by default on Pro/Team plans)
SELECT cron.schedule(
  'mark-no-show-consultations',
  '*/5 * * * *',
  'SELECT mark_no_show_consultations()'
);

SELECT cron.schedule(
  'mark-missed-calls',
  '*/5 * * * *',
  'SELECT mark_missed_calls()'
);

-- Index to make the status-based query fast
CREATE INDEX IF NOT EXISTS idx_consultations_status_scheduled
  ON consultations (status, scheduled_at)
  WHERE status = 'waiting_for_doctor';
