-- Migration: slot_duration_20min
--
-- Product decision: booking slots change from 60-minute to 20-minute
-- increments. Slot generation was already fully dynamic (derived from each
-- doctor's configured availability hours) — only the duration constant was
-- hardcoded, and duplicated in three places: the mobile client, the web
-- client, and this RPC's `p_slot_duration` default. This migration updates
-- the server-side default so a caller that omits `p_slot_duration` (there
-- should be none after the client fix, but this keeps the server the
-- authoritative source of truth) still gets the correct 20-minute value.
-- No other logic changes — the OUTSIDE_HOURS check already uses
-- `p_slot_duration` as a parameter, not a hardcoded number, so it continues
-- to work unchanged for any duration passed in.

CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,      -- doctor_profiles.id
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 20,   -- minutes; booking slots are 20 minutes
  p_patient_amount   numeric DEFAULT 0,
  p_doctor_amount    numeric DEFAULT 0,   -- unused: recomputed server-side below
  p_platform_amount  numeric DEFAULT 0,   -- unused: recomputed server-side below
  p_is_on_demand     boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consultation_id  uuid;
  v_avail            jsonb;
  v_accept_on_demand boolean;
  v_accept_scheduled boolean;
  v_day_key          text;
  v_day_cfg          jsonb;
  v_blocked          jsonb;
  v_date_str         text;
  v_start_mins       int;
  v_end_mins         int;
  v_slot_start_mins  int;
  v_commission_rate  numeric;
  v_platform_amount  numeric;
  v_doctor_amount    numeric;
  v_doctor_busy      boolean;
  v_patient_busy     boolean;
BEGIN
  -- Expire stale locks first (best-effort cleanup)
  DELETE FROM public.slot_locks WHERE expires_at < now();

  -- Patient busy check — On-Demand only, and independent of whether the
  -- doctor has ever configured availability (unlike the doctor-side checks
  -- below, which only run when availability is set).
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

  SELECT availability INTO v_avail FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_avail IS NOT NULL THEN
    v_accept_on_demand := COALESCE((v_avail->>'acceptOnDemand')::boolean, true);
    v_accept_scheduled := COALESCE((v_avail->>'acceptScheduled')::boolean, true);

    IF p_is_on_demand THEN
      IF NOT v_accept_on_demand THEN
        RAISE EXCEPTION 'ON_DEMAND_DISABLED: This doctor is not accepting on-demand consultations right now.';
      END IF;

      -- Busy check — On-Demand only. Scheduled bookings must not be blocked
      -- by the doctor's current session (see migration comment above).
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

      v_day_key := CASE EXTRACT(DOW FROM p_slot_start)
        WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
        WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
      END;
      v_day_cfg := v_avail -> v_day_key;
      IF v_day_cfg IS NULL OR COALESCE((v_day_cfg->>'enabled')::boolean, false) = false THEN
        RAISE EXCEPTION 'DAY_OFF: This doctor is not available on %.', v_day_key;
      END IF;

      v_blocked := COALESCE(v_avail->'blocked_dates', '[]'::jsonb);
      v_date_str := to_char(p_slot_start, 'YYYY-MM-DD');
      IF v_blocked ? v_date_str THEN
        RAISE EXCEPTION 'DATE_BLOCKED: This doctor is unavailable on the selected date.';
      END IF;

      -- Working-hours window — requires the full consultation (slot start
      -- through start+duration) to fit inside the doctor's configured hours
      -- for that day, mirroring the client's getAvailableSlots() logic.
      v_start_mins := _parse_time_to_minutes(v_day_cfg->>'startTime');
      v_end_mins   := _parse_time_to_minutes(v_day_cfg->>'endTime');
      IF v_start_mins IS NOT NULL AND v_end_mins IS NOT NULL THEN
        v_slot_start_mins := EXTRACT(HOUR FROM p_slot_start)::int * 60 + EXTRACT(MINUTE FROM p_slot_start)::int;
        IF v_slot_start_mins < v_start_mins OR v_slot_start_mins + p_slot_duration > v_end_mins THEN
          RAISE EXCEPTION 'OUTSIDE_HOURS: This time is outside the doctor''s working hours (% - %).',
            v_day_cfg->>'startTime', v_day_cfg->>'endTime';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Revenue split is always derived from the live admin-configured commission
  -- rate, not from client-supplied amounts.
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

  -- Atomically claim the slot — raises unique_violation if already taken
  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (p_doctor_id, p_slot_start, p_slot_duration, v_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    -- Roll back the consultation insert too
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available.';
  END;

  RETURN v_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric, boolean) TO authenticated;
