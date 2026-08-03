-- Migration: new_consultation_status
-- Extends the consultation workflow with a richer status lifecycle:
--   pending_payment  → initial creation, awaiting Chapa payment
--   waiting_for_doctor → payment confirmed, patient in waiting room
--   accepted         → doctor accepted the request
--   in_progress      → both parties are in the consultation room
--   completed        → doctor submitted summary and closed session
--   cancelled        → patient cancelled or payment failed
--   declined         → doctor explicitly declined the request
--
-- Old values (pending, active) are kept in the constraint for backwards
-- compatibility with any existing rows in the database.

-- ── 1. Extend the status CHECK constraint ────────────────────────────────────

DO $$
DECLARE
  conname text;
BEGIN
  SELECT tc.constraint_name INTO conname
  FROM information_schema.table_constraints tc
  WHERE tc.table_name    = 'consultations'
    AND tc.table_schema  = 'public'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name ILIKE '%status%'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE consultations DROP CONSTRAINT ' || quote_ident(conname);
  END IF;
END;
$$;

ALTER TABLE consultations
  ADD CONSTRAINT consultations_status_check
  CHECK (status IN (
    -- legacy values (kept for existing rows)
    'pending',
    'active',
    -- new workflow values
    'pending_payment',
    'waiting_for_doctor',
    'accepted',
    'in_progress',
    'completed',
    'cancelled',
    'declined'
  ));

-- ── 2. Update the notification trigger to handle new status names ────────────

CREATE OR REPLACE FUNCTION on_consultation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    -- ── NEW FLOW ──────────────────────────────────────────────────────────────

    -- Patient entered waiting room → notify the assigned doctor
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    -- Doctor accepted → notify patient ("doctor is ready, tap to join")
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Doctor declined → notify patient
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'declined' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    -- ── LEGACY FLOW (keep old rows working) ────────────────────────────────

    -- Old flow: status='pending' + payment confirmed + patient in waiting room
    ELSIF NEW.status = 'pending'
       AND NEW.payment_status = 'paid'
       AND NEW.waiting_started_at IS NOT NULL
       AND (
         OLD.payment_status IS DISTINCT FROM NEW.payment_status
         OR OLD.waiting_started_at IS DISTINCT FROM NEW.waiting_started_at
       )
    THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    -- Old flow: 'active' was used when doctor accepted
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Old flow: 'cancelled' was used for both patient-cancel and doctor-decline
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger to fire on all relevant column changes
DROP TRIGGER IF EXISTS trg_consultation_notification ON consultations;
CREATE TRIGGER trg_consultation_notification
  AFTER UPDATE OF status, payment_status, waiting_started_at ON consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_change();

-- ── 3. Also update the RLS policy on messages (was hardcoded to 'active') ───

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = public.get_user_id_from_jwt_sub()
    AND EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = messages.consultation_id
        AND (
          c.patient_id = public.get_user_id_from_jwt_sub()
          OR c.doctor_id = public.get_doctor_profile_id()
        )
        AND c.status IN ('active', 'accepted', 'in_progress')
    )
  );
