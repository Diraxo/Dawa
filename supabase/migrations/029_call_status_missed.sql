-- Migration: call_status_missed
-- Extends the consultation status constraint to include 'missed' and 'ended_abnormally',
-- which are set by the client when a patient doesn't answer or a call drops unexpectedly.
-- Also adds missed_at timestamp for audit tracking and a notification-dedup guard.

-- ── 1. Drop the existing status constraint and add the extended one ────────────

DO $$
DECLARE conname TEXT;
BEGIN
  SELECT tc.constraint_name INTO conname
  FROM information_schema.table_constraints tc
  WHERE tc.table_name     = 'consultations'
    AND tc.table_schema   = 'public'
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
    'ended_abnormally'
  ));

-- ── 2. Add missed_at timestamp column ─────────────────────────────────────────

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS missed_at TIMESTAMPTZ;

-- Auto-populate missed_at when status transitions to 'missed'
CREATE OR REPLACE FUNCTION _set_missed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'missed' AND OLD.status IS DISTINCT FROM 'missed' THEN
    NEW.missed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_missed_at ON public.consultations;
CREATE TRIGGER trg_set_missed_at
  BEFORE UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION _set_missed_at();

-- ── 3. Update the notification trigger to handle 'missed' status ──────────────

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
