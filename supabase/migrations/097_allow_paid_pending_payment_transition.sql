-- Migration 097: allow a patient to flip their own paid booking out of
-- pending_payment
--
-- Root cause (Release Blocker Issue 7 — "Development payment verification is
-- stuck", also latent in the live Chapa path): migration 091's transition
-- guard enumerates every (role, OLD.status -> NEW.status) pair a real call
-- site uses, but omitted pending_payment -> scheduled and pending_payment ->
-- waiting_for_doctor for the patient role entirely. Both payment-
-- return.tsx's own post-verification status flip and the dev-payment-bypass
-- flow (see BookingModal.tsx / supabase/functions/dev-payment-bypass) make
-- exactly that write from the patient's own authenticated client, using
-- getAuthClient(token) — not the service role. Every such write has silently
-- raised FORBIDDEN and been swallowed by a bare catch ever since 091 shipped,
-- so `status` stays stuck at 'pending_payment' forever: the on-demand poll
-- loop in payment-return.tsx never sees a status it recognizes and never
-- navigates to the waiting room, and a scheduled booking never appears in
-- Upcoming Appointments despite payment having actually succeeded.
--
-- Real Chapa payments mostly hid this because chapa-webhook's own
-- service-role resilience fallback (added for a different reason — client
-- killed mid-flow) usually wins the race and performs the same flip first,
-- bypassing this trigger entirely as auth.role() = 'service_role'. Dev-mode
-- payments have no such webhook and hit the gap every time.
--
-- Fix: allow the patient-driven pending_payment -> scheduled /
-- waiting_for_doctor transition, but ONLY when NEW.payment_status = 'paid' —
-- a column no non-service-role caller can ever set themselves (migration
-- 089's financial-column guard fires on the exact same UPDATE statement
-- before this check, in trigger-name order, so by the time this condition is
-- evaluated payment_status can only be 'paid' if a prior service-role write
-- already put it there). This does not reopen any payment-bypass path: a
-- patient still cannot mark their own row paid, so they still cannot forge
-- this transition for an unpaid booking.
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
       OR (NEW.status IN ('scheduled', 'waiting_for_doctor') AND OLD.status = 'pending_payment' AND NEW.payment_status = 'paid')
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
