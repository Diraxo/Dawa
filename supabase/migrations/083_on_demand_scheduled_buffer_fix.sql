-- Migration 083: fix the on-demand vs. scheduled-consultation buffer window
--
-- Root cause (Issue 1 of the CRITICAL FIX spec): migration 069's
-- v_doctor_soon check — carried forward unchanged by migration 073 — rejects
-- an on-demand booking whenever the doctor has a 'scheduled' row due within
-- SLOT_DURATION_MINS (20 minutes) of now. That value was borrowed from the
-- slot-duration constant, not chosen as a safety buffer: a doctor with a
-- 7:20 scheduled appointment was refused on-demand bookings starting at
-- 7:00, 16 minutes early, even though a fresh on-demand call could still
-- comfortably start and end before 7:20. Spec calls for a 5-minute buffer
-- instead, and asks that it be configurable rather than hardcoded again.
--
-- Fix: store the buffer in platform_settings (same admin-configurable
-- key/value pattern get_commission_rate() already uses) and read it via a
-- new get_on_demand_buffer_minutes() function. book_appointment_slot()'s
-- v_doctor_soon check now uses that value (5) instead of the hardcoded 20.
--
-- Also adds is_doctor_scheduled_soon(), mirroring the existing
-- is_doctor_busy() RPC, so clients can proactively grey out "On-Demand" and
-- show the real reason *before* the patient attempts to pay — the same
-- pattern already used for the busy check — instead of only discovering the
-- conflict from a rejected booking.

INSERT INTO public.platform_settings (key, value) VALUES
  ('on_demand_buffer_minutes', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_on_demand_buffer_minutes()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value::text::numeric FROM public.platform_settings WHERE key = 'on_demand_buffer_minutes'),
    5
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_on_demand_buffer_minutes() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_doctor_scheduled_soon(p_doctor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultations
    WHERE doctor_id = p_doctor_id
      AND status = 'scheduled'
      AND scheduled_at <= now() + (public.get_on_demand_buffer_minutes() || ' minutes')::interval
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_doctor_scheduled_soon(uuid) TO anon, authenticated;

-- book_appointment_slot(): same signature as migration 073 (CREATE OR
-- REPLACE in place) — only change is v_doctor_soon now using the
-- configurable buffer instead of the hardcoded 20-minute slot duration.
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
  v_is_online        boolean;
  v_commission_rate  numeric;
  v_platform_amount  numeric;
  v_doctor_amount    numeric;
  v_doctor_busy      boolean;
  v_patient_busy     boolean;
  v_doctor_soon      boolean;
BEGIN
  DELETE FROM public.slot_locks WHERE expires_at < now();

  IF p_slot_start < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: This time slot has already passed.';
  END IF;

  IF p_is_on_demand THEN
    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE patient_id = p_patient_id
        AND status IN ('pending_payment', 'waiting_for_doctor', 'accepted', 'in_progress')
    ) INTO v_patient_busy;

    IF v_patient_busy THEN
      RAISE EXCEPTION 'PATIENT_BUSY: You already have an active consultation. Please finish it before starting a new one.';
    END IF;
  END IF;

  SELECT availability, status, is_online INTO v_avail, v_doctor_status, v_is_online
  FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  IF p_is_on_demand THEN
    IF NOT COALESCE(v_is_online, false) THEN
      RAISE EXCEPTION 'DOCTOR_OFFLINE: This doctor is currently unavailable. Please choose another doctor.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE doctor_id = p_doctor_id
        AND status IN ('accepted', 'in_progress')
    ) INTO v_doctor_busy;

    IF v_doctor_busy THEN
      RAISE EXCEPTION 'DOCTOR_BUSY: This doctor is currently in another consultation. Please try again in a few minutes or choose another doctor.';
    END IF;

    v_doctor_soon := public.is_doctor_scheduled_soon(p_doctor_id);

    IF v_doctor_soon THEN
      RAISE EXCEPTION 'DOCTOR_SCHEDULED_SOON: This doctor has a scheduled consultation starting soon. Please choose another doctor or schedule a consultation.';
    END IF;
  ELSIF v_avail IS NOT NULL THEN
    PERFORM public._validate_scheduled_slot(v_avail, p_slot_start, p_slot_duration);
  END IF;

  v_commission_rate := public.get_commission_rate();
  v_platform_amount := round(p_patient_amount * v_commission_rate / 100);
  v_doctor_amount   := p_patient_amount - v_platform_amount;

  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status, payment_status,
    patient_amount, doctor_amount, platform_amount,
    is_on_demand
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    p_patient_amount, v_doctor_amount, v_platform_amount,
    p_is_on_demand
  )
  RETURNING id INTO v_consultation_id;

  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (p_doctor_id, p_slot_start, p_slot_duration, v_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available. Please select another available time.';
  END;

  RETURN v_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric, boolean) TO authenticated;
