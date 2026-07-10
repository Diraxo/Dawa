-- Migration: single_availability_toggle
--
-- Product spec: doctor_profiles.is_online becomes the ONLY availability
-- control across every platform (doctor mobile/web, patient mobile/web).
-- Two consequences at the DB layer:
--
-- 1. The three auto-offline mechanisms (mobile AppState background-grace
--    flip, web tab-hidden/pagehide flip, and this migration's own
--    mark_stale_doctors_offline() TTL cron sweep from migration 042) all
--    contradicted the new requirement that is_online must never change
--    except via an explicit Go Offline action. The client-side flips are
--    removed in application code; this migration removes the server-side
--    one — unscheduling the cron job and dropping the function so a
--    crashed/backgrounded/closed app can no longer silently flip a doctor
--    offline. Accepted tradeoff (confirmed with product): a doctor who
--    force-quits/uninstalls without pressing Go Offline stays "online"
--    until manually corrected.
--
-- 2. acceptOnDemand/acceptScheduled (booleans nested in the availability
--    jsonb, previously surfaced as separate "Accept Scheduled Appointments"
--    / "Accept On-Demand Consultations" toggles) are removed as booking
--    gates. Scheduled appointments must always be bookable regardless of
--    online status (only working-hours/blocked-dates/busy-state still
--    apply). On-demand bookings are now gated by is_online instead of the
--    old acceptOnDemand flag — book_appointment_slot() never checked
--    is_online at all before this, so this closes a real server-side gap
--    (a patient could previously book "on-demand" via direct RPC while the
--    doctor was toggled offline, as long as acceptOnDemand was true).
--
-- Old acceptOnDemand/acceptScheduled keys left in place inside any existing
-- availability jsonb rows — harmless dead data now that nothing reads them.

-- ── 1. Remove the server-side TTL auto-offline sweep ────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('mark-stale-doctors-offline');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job may not exist in this environment; nothing to unschedule
END $$;

DROP FUNCTION IF EXISTS public.mark_stale_doctors_offline();

-- ── 2. book_appointment_slot(): is_online gates on-demand, nothing gates
-- scheduled booking mode anymore ─────────────────────────────────────────
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

  SELECT availability, status, is_online INTO v_avail, v_doctor_status, v_is_online
  FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  IF p_is_on_demand THEN
    IF NOT COALESCE(v_is_online, false) THEN
      RAISE EXCEPTION 'DOCTOR_OFFLINE: This doctor is currently offline.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE doctor_id = p_doctor_id
        AND status IN ('accepted', 'in_progress')
    ) INTO v_doctor_busy;

    IF v_doctor_busy THEN
      RAISE EXCEPTION 'DOCTOR_BUSY: This doctor is currently in another consultation.';
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

-- ── 3. reschedule_appointment_slot(): drop the acceptScheduled gate,
-- rescheduling a scheduled appointment must always be allowed (subject to
-- the same hours/blocked-dates validation as before) ────────────────────
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
