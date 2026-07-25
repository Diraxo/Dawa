-- Migration 096: don't notify the doctor about a cancelled booking they never saw
--
-- Root cause (Issue 2 audit — "doctor must never receive a notification for a
-- cancelled consultation"): on_consultation_change()'s 'cancelled' branch
-- fires _call_consultation_notification('cancelled', ...) unconditionally for
-- ANY status -> 'cancelled' transition, including from 'pending_payment'.
-- BookingModal.tsx and payment-return.tsx flip an abandoned/never-paid
-- booking straight from 'pending_payment' to 'cancelled' — a row the doctor
-- never had any visibility into (it never reached 'scheduled' or
-- 'waiting_for_doctor', so it was never on their calendar or in their queue).
-- The doctor was still getting a "Request Cancelled — cancelled before you
-- responded" push for these, which is both factually wrong (they never had a
-- pending request) and exactly the kind of notification-for-a-request-they-
-- never-saw the release-blocker spec calls out.
--
-- Fix: skip the 'cancelled' notification event entirely when the row is
-- leaving 'pending_payment' — nobody needs telling (the patient already
-- knows, per the cancelled_by fix in handle-consultation-notification; the
-- doctor never knew this existed). Every other OLD status (pending,
-- waiting_for_doctor, scheduled) still notifies exactly as before.

CREATE OR REPLACE FUNCTION public.on_consultation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);
      IF OLD.running_late_notified = true THEN
        PERFORM _call_consultation_notification('doctor_ready', NEW.id);
      END IF;

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'declined' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled'
       AND OLD.status IS DISTINCT FROM 'pending_payment' THEN
      PERFORM _call_consultation_notification('cancelled', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'call_declined' THEN
      PERFORM _call_consultation_notification('call_declined', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'missed' THEN
      PERFORM _call_consultation_notification('missed_call', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
      PERFORM _call_freeze_consultation_channel(NEW.id);
      PERFORM _call_consultation_notification('completed', NEW.id);

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

    -- Patient paid for a future appointment -> confirm to patient + notify doctor
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'scheduled' THEN
      PERFORM _call_consultation_notification('scheduled_booking', NEW.id);

    -- Patient moved an already-scheduled appointment to a new time
    ELSIF OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at AND NEW.status = 'scheduled' THEN
      PERFORM _call_consultation_notification('rescheduled', NEW.id);

    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
