-- Migration: consultation_notification_triggers
-- Creates database triggers that call the handle-consultation-notification
-- Edge Function whenever a relevant consultation event occurs.
--
-- Requires:
--   pg_net extension (already enabled)
--   vault secret 'carehub_service_role_key' (already set in migration 001)

-- ── Helper: fires the Edge Function via pg_net ────────────────────────────────

CREATE OR REPLACE FUNCTION _call_consultation_notification(
  p_event           TEXT,
  p_consultation_id UUID,
  p_extra           JSONB DEFAULT '{}'::JSONB
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
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping notification';
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
$$;

-- ── Trigger 1: consultations table ───────────────────────────────────────────
-- INSERT  → doctor is notified of a new request
-- UPDATE  → patient is notified when doctor accepts (active) or declines (cancelled)

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM _call_consultation_notification('new_request', NEW.id);

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'active' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);
    ELSIF NEW.status = 'cancelled' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER INSERT OR UPDATE OF status ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();

-- ── Trigger 2: consultation_summaries table ───────────────────────────────────
-- INSERT → patient is notified that the doctor has filled their notes

CREATE OR REPLACE FUNCTION on_summary_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM _call_consultation_notification('summary_ready', NEW.consultation_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_summary_notification ON consultation_summaries;
CREATE TRIGGER trg_summary_notification
  AFTER INSERT ON consultation_summaries
  FOR EACH ROW EXECUTE FUNCTION on_summary_created();

-- ── Trigger 3: reviews table ──────────────────────────────────────────────────
-- INSERT → doctor is notified of the patient's star rating

CREATE OR REPLACE FUNCTION on_review_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM _call_consultation_notification(
    'review_received',
    NEW.consultation_id,
    jsonb_build_object('rating', NEW.rating)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_notification ON reviews;
CREATE TRIGGER trg_review_notification
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION on_review_created();
