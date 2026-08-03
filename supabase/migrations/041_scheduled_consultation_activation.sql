-- Migration: scheduled_consultation_activation
--
-- Problem: payment-return.tsx (mobile + web) set status='waiting_for_doctor'
-- immediately for EVERY paid consultation, whether booked "now" or scheduled
-- for later. on_consultation_change() fires the doctor 'new_request' push the
-- instant status becomes 'waiting_for_doctor', with no scheduled_at check —
-- so a consultation booked for tomorrow notified the doctor (and put the
-- patient in the waiting room) immediately, identical to "Start Now".
--
-- Fix: add a 'scheduled' status for paid, future bookings. Clients now set
-- status='scheduled' (not 'waiting_for_doctor') when booking for later. The
-- existing per-minute cron (trigger_appointment_notifications) flips
-- 'scheduled' -> 'waiting_for_doctor' once scheduled_at arrives, which
-- naturally re-fires the existing on_consultation_change notification path —
-- no changes needed to that trigger or to doctor-side queries.

-- ── 1. Extend the status CHECK constraint ────────────────────────────────────

-- Find the CHECK constraint that covers the 'status' column specifically —
-- ILIKE '%status%' on the constraint name is not enough, since
-- consultations_payment_status_check also matches that pattern and could be
-- dropped instead depending on row order.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.consultations'::regclass
    AND con.contype  = 'c'
    AND att.attname  = 'status'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE consultations DROP CONSTRAINT ' || quote_ident(conname);
  END IF;
END;
$$;

ALTER TABLE consultations
  ADD CONSTRAINT consultations_status_check
  CHECK (status IN (
    -- legacy values (kept for existing rows)
    'pending',
    'active',
    -- workflow values
    'pending_payment',
    'scheduled',
    'waiting_for_doctor',
    'accepted',
    'in_progress',
    'completed',
    'cancelled',
    'declined'
  ));

-- ── 2. Activate scheduled consultations once their time arrives ─────────────
-- Runs inside the existing per-minute cron job (carehub-appointment-notifications).
-- Flipping status here re-fires trg_consultation_notification's 'new_request'
-- branch at the correct time, so the "starting now" push below stays unchanged.

CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  -- waiting_started_at must be stamped to scheduled_at (not now()) here —
  -- it is the sort key doctor clients queue on (earliest first), so a
  -- consultation's queue position must reflect its booked time, not the
  -- moment the cron happened to run.
  UPDATE consultations
  SET status = 'waiting_for_doctor',
      waiting_started_at = scheduled_at
  WHERE status = 'scheduled'
    AND scheduled_at <= now();

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() - INTERVAL '30 seconds'
                            AND now() + INTERVAL '30 seconds'
    AND    status IN ('pending', 'waiting_for_doctor')
    AND    notification_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

-- ── 3. Reminders (15 min before) must also match 'scheduled' bookings ───────
-- Status stays 'scheduled' right up until scheduled_at itself, so the
-- 14-15-minutes-before reminder window needs to see that status too.

CREATE OR REPLACE FUNCTION trigger_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '14 minutes'
                            AND now() + INTERVAL '15 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;
