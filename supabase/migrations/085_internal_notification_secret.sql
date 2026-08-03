-- Migration 085: Move DB-triggered edge function calls off SUPABASE_SERVICE_ROLE_KEY
--
-- Root cause of the 2026-07-18 total notification outage: an in-progress,
-- uncommitted change to handle-consultation-notification/send-appointment-
-- notification switched their auth check from SUPABASE_SERVICE_ROLE_KEY to a
-- new INTERNAL_NOTIFICATION_SECRET, but no DB function was ever updated to
-- send that token — every call kept sending the 'carehub_service_role_key'
-- vault secret, so every request was rejected with 403. This migration
-- completes that change on the DB side, pointing every caller of the two
-- notification edge functions at the new 'internal_notification_secret'
-- vault entry (provisioned out-of-band to match the edge function secret of
-- the same name — never checked into a migration file).
--
-- _call_freeze_consultation_channel is deliberately NOT touched here: it
-- calls freeze-consultation-channel, which still authenticates with the
-- platform-managed SUPABASE_SERVICE_ROLE_KEY and was never part of this
-- break.

CREATE OR REPLACE FUNCTION public._call_consultation_notification(p_event text, p_consultation_id uuid, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping notification';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-consultation-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := jsonb_build_object(
      'event',           p_event,
      'consultation_id', p_consultation_id::text
    ) || p_extra,
    timeout_milliseconds := 10000
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_running_late_consultations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  FOR rec IN
    SELECT c.id
    FROM public.consultations c
    WHERE c.status = 'scheduled'
      AND c.scheduled_at <= now()
      AND c.running_late_notified = false
      AND EXISTS (
        SELECT 1 FROM public.consultations b
        WHERE b.doctor_id = c.doctor_id
          AND b.id <> c.id
          AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
      )
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-consultation-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('event', 'doctor_running_late', 'consultation_id', rec.id::text),
      timeout_milliseconds := 10000
    );

    UPDATE public.consultations SET running_late_notified = true WHERE id = rec.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_followup_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  FOR rec IN
    SELECT id
    FROM public.followup_reminders
    WHERE sent = false AND remind_at <= now()
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('reminder_id', rec.id::text, 'kind', 'followup'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_appointment_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
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
$function$;

CREATE OR REPLACE FUNCTION public.trigger_appointment_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;
