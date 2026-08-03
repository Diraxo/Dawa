-- Migration: fix_notification_trigger
-- Critical fix: the doctor must only be notified AFTER the patient's
-- payment is confirmed (payment_status = 'paid'), not when the consultation
-- row is first created.
--
-- Before this migration, the trigger fired on INSERT, which meant the
-- doctor's 30-second timer could start before the patient finished paying.
-- Now the trigger fires when payment_status changes to 'paid'.

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notify doctor: payment confirmed on a new consultation
  IF TG_OP = 'UPDATE'
     AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
     AND NEW.payment_status = 'paid'
     AND NEW.status = 'pending'
  THEN
    PERFORM _call_consultation_notification('new_request', NEW.id);

  -- Notify patient: doctor accepted
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'active'
  THEN
    PERFORM _call_consultation_notification('accepted', NEW.id);

  -- Notify patient: doctor declined or 30-second timeout
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'cancelled'
  THEN
    PERFORM _call_consultation_notification('declined', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger to fire on both status and payment_status changes
DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();
