-- Migration: fix_waiting_for_doctor_notification
-- Problem: migration 020 regressed on_consultation_change() back to firing
-- new_request only when status='pending' AND payment_status changes to 'paid'.
-- The current workflow never reaches status='pending' — it goes:
--   pending_payment → (chapa webhook sets payment_status='paid')
--                   → (payment-return.tsx sets status='waiting_for_doctor')
-- So the doctor notification never fired and notification_sent stayed false.
--
-- This migration also fixes:
--   - 'accepted' event: new flow uses status='accepted', not 'active'
--   - cron functions: both checked status='pending' which no longer exists
--     in the new workflow; updated to also match 'waiting_for_doctor'

-- ── 1. Fix the main notification trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    -- NEW FLOW: patient entered waiting room (payment confirmed) → notify doctor
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'waiting_for_doctor'
    THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    -- NEW FLOW: doctor accepted → notify patient
    ELSIF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'accepted'
    THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Doctor explicitly declined a paid consultation → notify both + credit issued
    ELSIF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'declined'
       AND NEW.payment_status = 'paid'
    THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    -- Patient cancelled their own paid consultation → notify patient, no credit
    ELSIF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'cancelled'
       AND NEW.payment_status = 'paid'
    THEN
      PERFORM _call_consultation_notification('cancelled', NEW.id);

    -- LEGACY: old flow used status='active' when doctor accepted
    ELSIF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'active'
    THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();

-- ── 2. Fix cron: appointment start notifications ──────────────────────────────
-- Scheduled appointments in the new workflow have status='waiting_for_doctor'
-- once paid; the old status='pending' no longer applies.

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

-- ── 3. Fix cron: appointment reminder notifications (15 min before) ───────────

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
    AND    status IN ('pending', 'waiting_for_doctor')
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
