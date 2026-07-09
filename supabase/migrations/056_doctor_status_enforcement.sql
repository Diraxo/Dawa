-- Migration: doctor_status_enforcement
--
-- Pre-deployment audit found that "Pending / Rejected / Suspended doctors
-- must not go online, accept consultations, or edit their schedule" was
-- ONLY ever enforced in UI code (and inconsistently even there — web's
-- Schedule page had no check at all). Nothing at the database layer
-- stopped any of this via a direct API/RPC call:
--   - doctor_profiles_update RLS (migration 002) has no WITH CHECK at all,
--     so a doctor could set is_online=true, rewrite availability, OR
--     silently self-promote their own `status` column to 'approved' —
--     the last one is a genuine privilege-escalation bug, not just a
--     restrictions gap.
--   - consultations_update RLS (migration 002) lets doctor_id=self move a
--     row to 'accepted' with no doctor-status check at all.
--   - book_appointment_slot() (latest version: migration 054) validates
--     acceptOnDemand/acceptScheduled/busy-state/hours but never checks
--     doctor_profiles.status, so a patient who retains a doctor's id
--     (stale page, bookmark, direct RPC call) can still book a
--     pending/rejected/suspended doctor even though RLS SELECT normally
--     hides them from search.
--
-- Fix: a single BEFORE UPDATE trigger on doctor_profiles enforces status
-- integrity + the online/schedule restrictions for non-admin actors, a
-- BEFORE UPDATE trigger on consultations blocks a non-approved doctor from
-- ever transitioning a row to accepted/active, and book_appointment_slot()
-- gains an explicit status check alongside its existing validations.

-- ── doctor_profiles: status integrity + online/schedule restrictions ───────
CREATE OR REPLACE FUNCTION public.enforce_doctor_status_restrictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins may freely change status, is_online, or availability. The admin
  -- API routes (carehub-web/app/api/admin/**) write through supabaseAdmin
  -- (SUPABASE_SERVICE_ROLE_KEY, see carehub-web/lib/supabase/server.ts),
  -- which has no Clerk JWT at all, so public.is_admin() (which inspects
  -- auth.jwt()->>'sub') can't recognize it — auth.role() = 'service_role'
  -- is the correct check for that path. public.is_admin() is kept too in
  -- case any future write goes through an authenticated admin session
  -- instead of the service-role client.
  IF public.is_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only an admin may ever change a doctor's own verification status —
  -- otherwise a doctor could self-approve/un-suspend via a direct update.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can change doctor verification status.';
  END IF;

  -- A non-approved doctor can never be marked online, regardless of what
  -- the client sends.
  IF NEW.is_online = true AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.is_online := false;
  END IF;

  -- A non-approved doctor can never change their availability/schedule.
  IF NEW.availability IS DISTINCT FROM OLD.availability AND OLD.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_NOT_APPROVED: Your account must be approved before you can edit your schedule.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_doctor_status_restrictions ON public.doctor_profiles;
CREATE TRIGGER trg_enforce_doctor_status_restrictions
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_doctor_status_restrictions();

-- ── consultations: block a non-approved doctor from accepting ──────────────
CREATE OR REPLACE FUNCTION public.enforce_doctor_approved_for_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_status text;
BEGIN
  IF NEW.status IN ('accepted', 'active') AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT status INTO v_doctor_status FROM public.doctor_profiles WHERE id = NEW.doctor_id;
    IF v_doctor_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'DOCTOR_NOT_APPROVED: This doctor is not currently approved to accept consultations.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_doctor_approved_for_accept ON public.consultations;
CREATE TRIGGER trg_enforce_doctor_approved_for_accept
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_doctor_approved_for_accept();

-- ── book_appointment_slot(): reject booking a non-approved doctor ──────────
-- Same 9-arg signature as migration 054 — CREATE OR REPLACE in place, only
-- change is the new v_doctor_status check right after the availability
-- fetch (before any on-demand/scheduled branching).
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 20,
  p_patient_amount   numeric DEFAULT 0,
  p_doctor_amount    numeric DEFAULT 0,
  p_platform_amount  numeric DEFAULT 0,
  p_is_on_demand     boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consultation_id  uuid;
  v_avail            jsonb;
  v_doctor_status    text;
  v_accept_on_demand boolean;
  v_accept_scheduled boolean;
  v_commission_rate  numeric;
  v_platform_amount  numeric;
  v_doctor_amount    numeric;
  v_doctor_busy      boolean;
  v_patient_busy     boolean;
BEGIN
  DELETE FROM public.slot_locks WHERE expires_at < now();

  IF p_is_on_demand THEN
    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE patient_id = p_patient_id
        AND status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    ) INTO v_patient_busy;

    IF v_patient_busy THEN
      RAISE EXCEPTION 'PATIENT_BUSY: You already have an active consultation. Please finish it before starting a new one.';
    END IF;
  END IF;

  SELECT availability, status INTO v_avail, v_doctor_status
  FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  IF v_avail IS NOT NULL THEN
    v_accept_on_demand := COALESCE((v_avail->>'acceptOnDemand')::boolean, true);
    v_accept_scheduled := COALESCE((v_avail->>'acceptScheduled')::boolean, true);

    IF p_is_on_demand THEN
      IF NOT v_accept_on_demand THEN
        RAISE EXCEPTION 'ON_DEMAND_DISABLED: This doctor is not accepting on-demand consultations right now.';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.consultations
        WHERE doctor_id = p_doctor_id
          AND status IN ('accepted', 'in_progress')
      ) INTO v_doctor_busy;

      IF v_doctor_busy THEN
        RAISE EXCEPTION 'DOCTOR_BUSY: This doctor is currently in another consultation.';
      END IF;
    ELSE
      IF NOT v_accept_scheduled THEN
        RAISE EXCEPTION 'SCHEDULED_DISABLED: This doctor is not accepting scheduled appointments right now.';
      END IF;

      PERFORM public._validate_scheduled_slot(v_avail, p_slot_start, p_slot_duration);
    END IF;
  END IF;

  v_commission_rate := public.get_commission_rate();
  v_platform_amount := round(p_patient_amount * v_commission_rate / 100);
  v_doctor_amount   := p_patient_amount - v_platform_amount;

  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status, payment_status,
    patient_amount, doctor_amount, platform_amount
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    p_patient_amount, v_doctor_amount, v_platform_amount
  )
  RETURNING id INTO v_consultation_id;

  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (p_doctor_id, p_slot_start, p_slot_duration, v_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available.';
  END;

  RETURN v_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric, boolean) TO authenticated;

-- ── reschedule_appointment_slot(): also block if doctor is no longer approved ──
CREATE OR REPLACE FUNCTION public.reschedule_appointment_slot(
  p_consultation_id uuid,
  p_new_slot_start  timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row              public.consultations%ROWTYPE;
  v_avail            jsonb;
  v_doctor_status    text;
  v_accept_scheduled boolean;
  v_duration         int;
BEGIN
  DELETE FROM public.slot_locks WHERE expires_at < now();

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consultation not found.';
  END IF;

  IF v_row.patient_id IS DISTINCT FROM public.get_user_id_from_jwt_sub() THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only reschedule your own appointments.';
  END IF;

  IF v_row.status IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only scheduled appointments can be rescheduled.';
  END IF;

  SELECT availability, status INTO v_avail, v_doctor_status
  FROM public.doctor_profiles WHERE id = v_row.doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  IF v_avail IS NOT NULL THEN
    v_accept_scheduled := COALESCE((v_avail->>'acceptScheduled')::boolean, true);
    IF NOT v_accept_scheduled THEN
      RAISE EXCEPTION 'SCHEDULED_DISABLED: This doctor is not accepting scheduled appointments right now.';
    END IF;
  END IF;

  SELECT slot_duration INTO v_duration
  FROM public.slot_locks
  WHERE consultation_id = p_consultation_id
  LIMIT 1;
  v_duration := COALESCE(v_duration, 20);

  IF v_avail IS NOT NULL THEN
    PERFORM public._validate_scheduled_slot(v_avail, p_new_slot_start, v_duration);
  END IF;

  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (v_row.doctor_id, p_new_slot_start, v_duration, p_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available.';
  END;

  DELETE FROM public.slot_locks
  WHERE consultation_id = p_consultation_id
    AND slot_start = v_row.scheduled_at;

  UPDATE public.consultations
  SET scheduled_at           = p_new_slot_start,
      previous_scheduled_at  = v_row.scheduled_at,
      reminder_30_sent       = false,
      reminder_5_sent        = false,
      notification_sent      = false
  WHERE id = p_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz) TO authenticated;

-- ── doctor_profiles.total_consultations: was a dead column, never written ──
-- by any trigger or app code (confirmed by audit). Keep it live going
-- forward with an AFTER UPDATE trigger, and backfill every doctor's real
-- count now so profile cards stop showing a stale/zero number.
CREATE OR REPLACE FUNCTION public.update_doctor_total_consultations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.doctor_profiles
    SET total_consultations = (
      SELECT count(*) FROM public.consultations
      WHERE doctor_id = NEW.doctor_id AND status = 'completed'
    )
    WHERE id = NEW.doctor_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_doctor_total_consultations ON public.consultations;
CREATE TRIGGER trg_update_doctor_total_consultations
  AFTER UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_doctor_total_consultations();

UPDATE public.doctor_profiles dp
SET total_consultations = COALESCE((
  SELECT count(*) FROM public.consultations c
  WHERE c.doctor_id = dp.id AND c.status = 'completed'
), 0);
