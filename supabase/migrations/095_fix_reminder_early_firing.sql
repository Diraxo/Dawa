-- Migration 095: fix reminder/start notifications firing EARLY
--
-- Root cause (release-blocker report: appointment at 3:00 PM, notified "10
-- minutes" at 2:47 PM — 13 minutes out, not 10):
--
-- Migrations 068/074 widened each tier's window on the wrong edge to build in
-- catch-up tolerance for a missed/delayed pg_cron tick. A tier's condition
-- was `scheduled_at BETWEEN now() + X AND now() + X + margin` (e.g. reminder_10:
-- `BETWEEN now()+10m AND now()+13m`). Under normal per-minute cron operation
-- (no ticks ever missed), the gap between "now" and the appointment shrinks by
-- ~1 minute every tick, so the FIRST tick where this condition becomes true is
-- always at the *far* edge (13 minutes out for the "10-minute" tier) — i.e.
-- every single reminder fires ~3 minutes earlier than its own label claims,
-- every time, not just on a missed tick. That's the bug: the catch-up margin
-- was applied in the direction that causes early firing instead of late
-- firing.
--
-- Fix: flip the margin to the near (past) side of the target instead of the
-- far (future) side — `BETWEEN now() + (X - margin) AND now() + X`. This
-- still tolerates a delayed/missed tick (it'll catch up up to `margin`
-- minutes late), but the window's far edge is now the exact target itself,
-- so a tier can never fire before its promised time — only exactly on time or
-- slightly late. Same fix applied to trigger_appointment_notifications()'s
-- "start" window, which had a symmetric ±30s early allowance.

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

  -- Far edge is now() itself (never announce "starting" before it actually
  -- has); near edge widened to 3 minutes so a missed tick still catches up
  -- instead of losing the notification entirely.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() - INTERVAL '3 minutes'
                            AND now()
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

  -- 30-minutes-before tier — far edge is exactly the 30-minute mark (never
  -- early); near edge gives a 3-minute catch-up window for a delayed tick.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '27 minutes'
                            AND now() + INTERVAL '30 minutes'
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
    WHERE  scheduled_at BETWEEN now() + INTERVAL '7 minutes'
                            AND now() + INTERVAL '10 minutes'
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
    WHERE  scheduled_at BETWEEN now() + INTERVAL '2 minutes'
                            AND now() + INTERVAL '5 minutes'
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
