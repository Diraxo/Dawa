-- 040_decline_cancel_workflow.sql
--
-- Consultation decline/cancel/reschedule overhaul:
--   1. Add 'call_declined' status (patient explicitly declines the ringing
--      phone/video call, distinct from a silent 'missed' timeout).
--   2. Add 'doctor_missed' and 'no_show' to the live status CHECK constraint —
--      both are already written by app code (waiting-room.tsx, and the
--      mark_doctor_missed_consultations()/mark_no_show_consultations() cron
--      functions from migrations 018/023) but were never actually present in
--      the live constraint, so those UPDATEs have been silently failing.
--   3. Add decline_reason / declined_at / declined_by / cancelled_by /
--      replacement_consultation_id so admin can see who declined/cancelled a
--      consultation, why, and what replaced it.
--   4. Extend the credit-issuing trigger so a PRE-ACCEPTANCE patient cancel
--      (or the reschedule flow, which is cancel + rebook) also preserves the
--      consultation credit — previously only an explicit doctor decline did,
--      even though the app's UI already promised the payment carries over.
--   5. Fix on_consultation_change(): a legacy branch was routing
--      status -> 'cancelled' to the 'declined' notification event (the
--      credit-preserved wording), so patients who cancelled their own request
--      were told "your doctor is unavailable, credit preserved" even though
--      no credit was ever recorded. 'cancelled' now fires the existing,
--      correctly-worded 'cancelled' event; a new 'call_declined' branch is
--      added for the new ringing-call-decline status.

-- 1 & 2. Status values
ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_status_check;
ALTER TABLE consultations
  ADD CONSTRAINT consultations_status_check
  CHECK (status IN (
    -- legacy values
    'pending',
    'active',
    -- standard workflow
    'pending_payment',
    'waiting_for_doctor',
    'accepted',
    'in_progress',
    'completed',
    'cancelled',
    'declined',
    -- call-specific outcomes
    'missed',
    'call_declined',
    'doctor_missed',
    'no_show',
    'ended_abnormally'
  ));

-- 3. Decline/cancel provenance columns
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS replacement_consultation_id uuid REFERENCES consultations(id);

-- 4. Credit issuance: doctor decline (unchanged) OR patient/admin cancel while
-- still pre-acceptance (new). Cancelling an already-accepted/in-progress
-- consultation does NOT get a credit here — that keeps section 6B's "already
-- started -> follow existing rules" behavior unchanged.
CREATE OR REPLACE FUNCTION public.set_consultation_credit_on_decline()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(NEW.payment_status, OLD.payment_status) = 'paid'
     AND NOT COALESCE(NEW.consultation_credit, false)
     AND (
       NEW.status = 'declined'
       OR (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor'))
     )
  THEN
    NEW.consultation_credit := true;
    NEW.credit_amount := COALESCE(NEW.patient_amount, OLD.patient_amount, 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. Notification routing fix + new call_declined branch
CREATE OR REPLACE FUNCTION public.on_consultation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    -- Patient entered waiting room -> notify the assigned doctor
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    -- Doctor accepted -> notify patient (system call push handled by edge function)
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Doctor declined -> notify patient (credit preserved)
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'declined' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    -- Patient (or admin) cancelled -> notify patient (no credit-preserved wording)
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
      PERFORM _call_consultation_notification('cancelled', NEW.id);

    -- Patient explicitly declined the ringing call -> notify doctor
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'call_declined' THEN
      PERFORM _call_consultation_notification('call_declined', NEW.id);

    -- Patient missed (timed out on) the call -> notify doctor
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'missed' THEN
      PERFORM _call_consultation_notification('missed_call', NEW.id);

    -- Consultation completed -> lock the Stream channel server-side
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
      PERFORM _call_freeze_consultation_channel(NEW.id);

    -- Legacy flow (rows created before the new-flow statuses existed)
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

    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
