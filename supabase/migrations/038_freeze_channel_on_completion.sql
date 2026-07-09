-- Migration: freeze_channel_on_completion
-- Server-side chat lock: the instant a consultation's status flips to
-- 'completed', call the freeze-consultation-channel Edge Function (via
-- pg_net, using the same vault service-role key pattern as the existing
-- notification triggers) so the Stream channel is locked down by Stream
-- itself — not left to client-side composer hiding.

-- ── Helper: fires the freeze-consultation-channel Edge Function ─────────────

CREATE OR REPLACE FUNCTION _call_freeze_consultation_channel(
  p_consultation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping channel freeze';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/freeze-consultation-channel',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := jsonb_build_object('consultation_id', p_consultation_id::text),
    timeout_milliseconds := 10000
  );
END;
$$;

-- ── Extend on_consultation_change() with a 'completed' branch ───────────────
-- (full body carried over from 029_call_status_missed.sql, plus the new branch)

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    -- Patient entered waiting room → notify the assigned doctor
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    -- Doctor accepted → notify patient (system call push handled by edge function)
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Doctor declined → notify patient
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'declined' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    -- Patient missed the call → notify doctor
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'missed' THEN
      PERFORM _call_consultation_notification('missed_call', NEW.id);

    -- Consultation completed → lock the Stream channel server-side
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
      PERFORM _call_freeze_consultation_channel(NEW.id);

    -- ── Legacy flow ────────────────────────────────────────────────────────────

    ELSIF NEW.status = 'pending'
       AND NEW.payment_status = 'paid'
       AND NEW.waiting_started_at IS NOT NULL
       AND (
         OLD.payment_status IS DISTINCT FROM NEW.payment_status
         OR OLD.waiting_started_at IS DISTINCT FROM NEW.waiting_started_at
       )
    THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status, waiting_started_at ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();
