-- Migration 074: give reminder/start-notification cron windows a catch-up
-- margin, so a single skipped or delayed pg_cron tick doesn't permanently
-- drop a reminder.
--
-- Root cause (Issue 8 audit): trigger_appointment_reminders()'s three tiers
-- (migration 066) each match a window exactly as wide as the cron interval
-- itself (`BETWEEN now()+30m AND now()+31m`, cron runs `* * * * *`), with no
-- overlap margin. If one tick is skipped or delayed past the next tick's
-- window start (DB load, a prior run raising inside the same transaction as
-- documented in migration 068, pg_cron restart), the appointment's
-- scheduled_at passes straight through that tier's window between ticks and
-- the reminder is never sent — there is no backfill/catch-up logic. Same gap
-- exists in trigger_appointment_notifications()'s start-notification window
-- (`now()-30s .. now()+30s`).
--
-- Fix: widen each window's stale (far) edge by ~3x the cron interval while
-- keeping the near edge unchanged, so a reminder never fires early relative
-- to its tier's promise, but tolerates a few missed/delayed ticks before
-- being lost. The existing *_sent boolean flags (checked in the WHERE
-- clause, set by send-appointment-notification) remain the sole
-- exactly-once guard, so widening the window cannot cause duplicate sends —
-- it only widens the chance a late tick still catches a row the previous
-- tick missed.

CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  UPDATE consultations c
  SET status = 'waiting_for_doctor',
      waiting_started_at = c.scheduled_at
  WHERE c.status = 'scheduled'
    AND c.scheduled_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM consultations b
      WHERE b.doctor_id = c.doctor_id
        AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations e
      WHERE e.doctor_id = c.doctor_id
        AND e.id <> c.id
        AND e.status = 'scheduled'
        AND e.scheduled_at <= now()
        AND e.scheduled_at < c.scheduled_at
    );

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping';
    RETURN;
  END IF;

  -- Near edge unchanged (never fire more than 30s before actual start);
  -- far edge widened from 30s to 3 minutes to survive a couple of missed
  -- cron ticks before the "consultation start" notification is lost.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() - INTERVAL '3 minutes'
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

  -- 30-minutes-before tier — near edge unchanged (never announce "30
  -- minutes" when it's actually less), far edge widened 1m -> 3m.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '30 minutes'
                            AND now() + INTERVAL '33 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_30_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_30'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  -- 10-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '10 minutes'
                            AND now() + INTERVAL '13 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_10_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_10'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  -- 5-minutes-before tier — only for bookings made <10 minutes before their
  -- own slot (never got a real chance at the 30/10-minute windows above).
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '5 minutes'
                            AND now() + INTERVAL '8 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_5_sent = FALSE
    AND    (scheduled_at - created_at) < INTERVAL '10 minutes'
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_5'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;
