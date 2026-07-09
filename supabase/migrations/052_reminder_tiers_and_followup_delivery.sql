-- Migration 052: Reminder Tiers + Follow-up Reminder Delivery
-- 1. consultations: reminder_30_sent / reminder_5_sent (replaces single
--    ~15-minute reminder_sent window with two tiers: 30 min and 5 min
--    before scheduled_at, for both patient and doctor).
-- 2. trigger_appointment_reminders() rewritten to fire both tiers via
--    send-appointment-notification (kind='reminder_30' | 'reminder_5').
-- 3. "Ready" (kind='start') copy aligned to spec wording.
-- 4. process_followup_reminders() rewritten to call the edge function
--    (push + in-app) per pending row instead of inserting an in-app row
--    directly — it was never wired to a push send.
-- 5. New pg_cron job actually invoking process_followup_reminders() — the
--    function has existed since migration 024 but was never scheduled, so
--    doctor-scheduled follow-up reminders were silently never delivered.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS reminder_30_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_5_sent boolean NOT NULL DEFAULT false;

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

  -- 30-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '30 minutes'
                            AND now() + INTERVAL '31 minutes'
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

  -- 5-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '5 minutes'
                            AND now() + INTERVAL '6 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_5_sent = FALSE
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

-- process_followup_reminders(): now calls the edge function per pending row
-- (push + in-app + mark-sent all happen there) instead of inserting an
-- in-app notification row directly with no push and no invoking cron.
CREATE OR REPLACE FUNCTION public.process_followup_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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
$$;

-- Actually invoke process_followup_reminders() — it existed since migration
-- 024 with no cron.schedule anywhere calling it, so scheduled follow-up
-- reminders were written to the DB but never delivered.
SELECT cron.schedule(
  'carehub-followup-reminders',
  '* * * * *',
  'SELECT public.process_followup_reminders();'
);
