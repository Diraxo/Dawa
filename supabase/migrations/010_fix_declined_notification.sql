-- Migration: fix_declined_notification
-- Problem: the 'declined' notification was firing whenever a consultation
-- was cancelled regardless of payment_status. This caused a phantom
-- "Doctor did not respond / refund processing" message during step 4 of
-- booking when the consultation was cancelled because Chapa payment init
-- failed — even though no payment was ever made.
--
-- Fix: the 'declined' notification (and the refund messaging) only makes
-- sense when the patient actually paid. Guard the declined branch with
-- payment_status = 'paid' so that cancellations of unpaid consultations
-- are silently cleaned up without notifying anyone.
--
-- Also: for the 'declined' event, notify the DOCTOR as well so they know
-- a request timed out (the matching record on their incoming-request screen
-- also needs a push so the UI updates even if the app is backgrounded).

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

  -- Notify BOTH: doctor timed out or declined.
  -- Only fire when payment was already confirmed — silent cleanup otherwise.
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'cancelled'
     AND NEW.payment_status = 'paid'
  THEN
    PERFORM _call_consultation_notification('declined', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger already exists from 009 — the function replacement above is enough.
-- Re-create it explicitly to be safe.
DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();
