-- Migration 092: fix a regression migration 091 would otherwise cause
--
-- migration 066's trg_consultation_resolved_activate_next (AFTER UPDATE OF
-- status) synchronously calls _activate_next_queued_for_doctor(), which
-- writes status='waiting_for_doctor' on a DIFFERENT consultation row (the
-- doctor's next scheduled appointment) — inside the SAME database session as
-- whichever patient or doctor action resolved the current one (declined,
-- completed, cancelled, missed, ...). auth.role()/get_user_id_from_jwt_sub()
-- still reflect that original caller for the entire transaction regardless
-- of SECURITY DEFINER, so 091's guard would see a caller who is neither the
-- patient nor doctor of that other row (or, when it happens to be the same
-- doctor's own row, a 'waiting_for_doctor' <- 'scheduled' transition that
-- isn't in the doctor's allowed set) and reject it — breaking automatic
-- queue promotion for every doctor with a scheduled-appointment backlog.
--
-- Fix: _activate_next_queued_for_doctor sets a transaction-local marker
-- immediately before its internal write; the guard trigger checks it first
-- and bypasses. Scoped narrowly to this one function (not a blanket
-- SECURITY DEFINER bypass) so no other privilege escalation surface opens up.

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

  IF current_setting('carehub.system_status_write', true) = 'on' THEN
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

CREATE OR REPLACE FUNCTION public._activate_next_queued_for_doctor(p_doctor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('carehub.system_status_write', 'on', true);

  UPDATE public.consultations c
  SET status             = 'waiting_for_doctor',
      waiting_started_at  = c.scheduled_at
  WHERE c.doctor_id = p_doctor_id
    AND c.status = 'scheduled'
    AND c.scheduled_at <= now()
    -- doctor must not already be occupied by (or waiting on) another consultation
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations b
      WHERE b.doctor_id = p_doctor_id
        AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    )
    -- only the earliest-due overdue appointment may activate — never skip ahead
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations e
      WHERE e.doctor_id = p_doctor_id
        AND e.id <> c.id
        AND e.status = 'scheduled'
        AND e.scheduled_at <= now()
        AND e.scheduled_at < c.scheduled_at
    );

  PERFORM set_config('carehub.system_status_write', 'off', true);
END;
$$;
