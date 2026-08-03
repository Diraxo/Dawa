-- Migration: waiting_room_started_at
-- Problem: The doctor was notified when payment was confirmed, but the patient
-- might still be on the payment-success page. Now the notification fires only
-- when the patient actually arrives at the waiting room (waiting_started_at set).
-- The doctor's timer is synced from this timestamp, not a local countdown.

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS waiting_started_at TIMESTAMPTZ;

-- Replace the trigger function to fire new_request only when BOTH conditions are
-- true: payment_status='paid' AND waiting_started_at IS NOT NULL.
-- It fires on whichever UPDATE satisfies the second condition last, so there is
-- no race between the Chapa webhook and the patient entering the waiting room.
CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notify doctor: patient is in the waiting room AND payment is confirmed.
  -- Fires when whichever of these two events happens last.
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'pending'
     AND NEW.payment_status = 'paid'
     AND NEW.waiting_started_at IS NOT NULL
     AND (
       (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
       OR (OLD.waiting_started_at IS DISTINCT FROM NEW.waiting_started_at)
     )
  THEN
    PERFORM _call_consultation_notification('new_request', NEW.id);

  -- Notify patient: doctor accepted
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'active'
  THEN
    PERFORM _call_consultation_notification('accepted', NEW.id);

  -- Notify patient: doctor declined or timeout
  ELSIF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'cancelled'
  THEN
    PERFORM _call_consultation_notification('declined', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger to also watch waiting_started_at
DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status, waiting_started_at ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();
