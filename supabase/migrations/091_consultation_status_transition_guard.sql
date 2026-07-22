-- Migration 091: restrict who can move a consultation to which status
--
-- consultations_update RLS (migration 002) only checks row ownership
-- (patient_id = self OR doctor_id = self), with no WITH CHECK distinguishing
-- *which* status a patient vs. a doctor may write. Migration 089 closed the
-- financial-column tampering gap but explicitly left status alone. That means
-- today a patient's own authenticated client can PATCH their own consultation
-- row to any status in the check constraint, bypassing the app entirely:
--   - status: 'completed' — marks the visit done with no consultation_summary
--     ever required (summaries_insert already requires doctor ownership, so
--     the row would end up completed with no medical record).
--   - status: 'doctor_missed' or 'declined' — migration 061's credit trigger
--     fires a refund/credit the instant NEW.status lands on either value,
--     with no check on who made the write. A patient could self-issue a
--     credit for a doctor who never missed anything.
--   - status: 'accepted' — skips the doctor's Accept action (and the
--     doctor-busy checks that only run inside the app's own accept flow),
--     starting a consultation the doctor never agreed to take.
--
-- Fix: a BEFORE UPDATE trigger that, for non-privileged callers, only allows
-- the exact (caller role, OLD.status → NEW.status) pairs every real call site
-- in app/, carehub-web/, and supabase/functions/ actually uses today. Verified
-- against every `.from('consultations').update({ status: ... })` in the tree:
--
--   patient:  cancelled     <- pending_payment, waiting_for_doctor
--             missed        <- accepted, waiting_for_doctor
--             call_declined <- accepted
--             in_progress   <- accepted, active
--   doctor:   accepted      <- waiting_for_doctor
--             declined      <- waiting_for_doctor
--             in_progress   <- accepted, active
--             completed     <- accepted, in_progress, active
--
-- Any status not in NEW's allowed set for that role, or any status change at
-- all when the caller is neither the row's patient nor its doctor, is
-- rejected. Non-status columns are untouched (own ownership RLS + migration
-- 089's financial guard already cover those). service_role, cron (auth.role()
-- IS NULL), and admin sessions bypass entirely — no client-facing flow is
-- service-role except book_appointment_slot()/reschedule_appointment_slot()
-- (SECURITY DEFINER, never touch status directly) and the cron/webhook
-- functions that own 'scheduled', 'active', 'no_show', 'doctor_missed'
-- (cron-only), and 'ended_abnormally'.

CREATE OR REPLACE FUNCTION public.guard_consultation_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id   uuid;
  v_caller_doctor_id uuid;
  v_is_patient       boolean;
  v_is_doctor        boolean;
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_caller_user_id   := public.get_user_id_from_jwt_sub();
  v_caller_doctor_id := public.get_doctor_profile_id();
  v_is_patient       := OLD.patient_id = v_caller_user_id;
  v_is_doctor        := OLD.doctor_id = v_caller_doctor_id;

  IF v_is_patient THEN
    IF (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor'))
       OR (NEW.status = 'missed' AND OLD.status IN ('accepted', 'waiting_for_doctor'))
       OR (NEW.status = 'call_declined' AND OLD.status = 'accepted')
       OR (NEW.status = 'in_progress' AND OLD.status IN ('accepted', 'active'))
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FORBIDDEN: Patients cannot change a consultation from % to %.', OLD.status, NEW.status;
  END IF;

  IF v_is_doctor THEN
    IF (NEW.status = 'accepted' AND OLD.status = 'waiting_for_doctor')
       OR (NEW.status = 'declined' AND OLD.status = 'waiting_for_doctor')
       OR (NEW.status = 'in_progress' AND OLD.status IN ('accepted', 'active'))
       OR (NEW.status = 'completed' AND OLD.status IN ('accepted', 'in_progress', 'active'))
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FORBIDDEN: Doctors cannot change a consultation from % to %.', OLD.status, NEW.status;
  END IF;

  RAISE EXCEPTION 'FORBIDDEN: You do not have permission to change this consultation''s status.';
END;
$$;

DROP TRIGGER IF EXISTS trg_01_guard_consultation_status_transitions ON public.consultations;
CREATE TRIGGER trg_01_guard_consultation_status_transitions
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_consultation_status_transitions();
