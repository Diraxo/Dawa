-- Migration 105: atomic "mark as sent" claim for appointment notifications/reminders
--
-- Phase-4 scheduling audit (2026-07-30), finding M1: trigger_appointment_
-- notifications() and trigger_appointment_reminders() only ever *checked*
-- notification_sent/reminder_*_sent = false in SQL before dispatching a
-- push; the flag itself was only flipped true later, inside
-- send-appointment-notification, after the push had already gone out. Since
-- pg_cron ticks on a fixed one-minute cadence independent of when a row
-- actually became eligible, and the reminder tiers' catch-up margin
-- (migration 074) deliberately makes a row eligible across several
-- consecutive ticks, any edge-function latency spike (cold start, FCM/APNs
-- slowness, a queued pg_net backlog) could let the same row be re-selected
-- and re-dispatched by a later tick before the first dispatch's flag write
-- landed — a duplicate-push risk, not a data-loss one (this subsystem is
-- deliberately fail-open).
--
-- Fix: claim each row atomically in SQL (UPDATE ... WHERE flag = false
-- RETURNING id) immediately before dispatching, so at most one cron
-- invocation can ever claim a given row for a given kind — closing the
-- TOCTOU window without changing anything about net.http_post's own
-- fire-and-forget delivery semantics. send-appointment-notification's own
-- already-sent guard and its own post-dispatch flag write are unchanged and
-- remain a harmless no-op layer of defense in depth.

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
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations p
      WHERE p.patient_id = c.patient_id
        AND p.id <> c.id
        AND p.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    );

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  -- Far edge is now() itself (never announce "starting" before it actually
  -- has); near edge widened to 3 minutes so a missed tick still catches up
  -- instead of losing the notification entirely. Claimed atomically (M1).
  FOR rec IN
    UPDATE consultations
    SET notification_sent = TRUE
    WHERE scheduled_at BETWEEN now() - INTERVAL '3 minutes'
                            AND now()
      AND status IN ('pending', 'waiting_for_doctor')
      AND notification_sent = FALSE
    RETURNING id
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
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  -- 30-minutes-before tier — far edge is exactly the 30-minute mark (never
  -- early); near edge gives a 3-minute catch-up window for a delayed tick.
  -- Claimed atomically (M1).
  FOR rec IN
    UPDATE consultations
    SET reminder_30_sent = TRUE
    WHERE scheduled_at BETWEEN now() + INTERVAL '27 minutes'
                            AND now() + INTERVAL '30 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_30_sent = FALSE
    RETURNING id
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
    UPDATE consultations
    SET reminder_10_sent = TRUE
    WHERE scheduled_at BETWEEN now() + INTERVAL '7 minutes'
                            AND now() + INTERVAL '10 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_10_sent = FALSE
    RETURNING id
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
    UPDATE consultations
    SET reminder_5_sent = TRUE
    WHERE scheduled_at BETWEEN now() + INTERVAL '2 minutes'
                            AND now() + INTERVAL '5 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_5_sent = FALSE
      AND (scheduled_at - created_at) < INTERVAL '10 minutes'
    RETURNING id
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
