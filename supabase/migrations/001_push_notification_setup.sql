-- Migration: push_notification_setup
-- Applied to: Diraxo's Project (ulrgkqjjiclulnuotifh)
--
-- Prereqs (already done):
--   CREATE EXTENSION pg_cron  (extensions schema)
--   CREATE EXTENSION pg_net   (extensions schema)
--   vault.create_secret(service_role_key, 'carehub_service_role_key', ...)

-- 1. Store Expo push token per device
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 2. Prevent duplicate start notifications for the same appointment
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Called by pg_cron every minute.
--    Finds consultations starting within ±30 s and calls the Edge Function.
--    The service role key is read from Supabase Vault at runtime.
CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
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
    WHERE  scheduled_at BETWEEN now() - INTERVAL '30 seconds'
                            AND now() + INTERVAL '30 seconds'
    AND    status            = 'pending'
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

-- 4. Schedule the cron job
SELECT cron.schedule(
  'carehub-appointment-notifications',
  '* * * * *',
  'SELECT trigger_appointment_notifications();'
);
