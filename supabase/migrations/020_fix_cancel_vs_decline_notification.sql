-- Migration: fix_cancel_vs_decline_notification
-- Problem: the 'declined' notification (which includes "Your consultation credit has been
-- preserved") was firing whenever status changed to 'cancelled' — including when the
-- PATIENT cancelled their own consultation. Credits are only issued on doctor-decline
-- (status = 'declined'), not on patient self-cancel (status = 'cancelled').
--
-- Fix:
--   status = 'declined' (doctor explicitly declined)  → fire 'declined' event → credit notification
--   status = 'cancelled' (patient cancelled/timeout)  → fire 'cancelled' event → simple cancellation notification

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notify DOCTOR: payment confirmed → new consultation request
  IF TG_OP = 'UPDATE'
     AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
     AND NEW.payment_status = 'paid'
     AND NEW.status = 'pending'
  THEN
    PERFORM _call_consultation_notification('new_request', NEW.id);

  -- Notify PATIENT: doctor accepted
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'active'
  THEN
    PERFORM _call_consultation_notification('accepted', NEW.id);

  -- Notify BOTH: doctor explicitly declined a paid consultation → credit issued
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'declined'
     AND NEW.payment_status = 'paid'
  THEN
    PERFORM _call_consultation_notification('declined', NEW.id);

  -- Notify PATIENT: patient cancelled their own paid consultation → no credit
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'cancelled'
     AND NEW.payment_status = 'paid'
  THEN
    PERFORM _call_consultation_notification('cancelled', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();
