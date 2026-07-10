-- Migration: remove_waiting_room_timeouts_and_credit_type_lock
--
-- Critical production fix — the consultation record must be the single
-- source of truth; the waiting room (a paid consultation sitting in
-- 'waiting_for_doctor') must never disappear on its own. Only an explicit
-- doctor accept/decline or a patient cancel may end that state.
--
-- 1. Removes the two pg_cron jobs that auto-expire a still-waiting
--    consultation without any doctor action:
--      - mark-doctor-missed          (waiting_for_doctor -> doctor_missed
--        after a fixed countdown)
--      - mark-no-show-consultations  (waiting_for_doctor -> no_show 30 min
--        past a scheduled booking's start time)
--    Both were confirmed live and active in production. Their sibling jobs
--    mark-missed-calls / mark-stale-consultations operate on a different,
--    already-connected phase (post-accept ringing / heartbeat staleness)
--    and are intentionally left alone — out of scope of the waiting-room fix.
--
-- 2. Reverts set_consultation_credit_on_decline() to only fire on an actual
--    'declined' or pre-accept 'cancelled' transition — the 'doctor_missed'
--    branch added in migration 061 is now unreachable dead code since
--    nothing can ever write that status again.
--
-- 3. Closes a duplicate-payment race: book_appointment_slot()'s on-demand
--    patient-busy check excluded 'pending_payment', so a patient could
--    start two simultaneous checkouts (e.g. two doctors, two tabs/devices)
--    and pay twice. Now included.

-- ── 1. Unschedule + drop the waiting-room timeout jobs ──────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('mark-doctor-missed');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('mark-no-show-consultations');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP FUNCTION IF EXISTS public.mark_doctor_missed_consultations();
DROP FUNCTION IF EXISTS public.mark_no_show_consultations();

-- ── 2. Credit issuance no longer needs a doctor_missed branch ───────────────
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

-- ── 3. book_appointment_slot(): include pending_payment in the on-demand
-- patient-busy check ─────────────────────────────────────────────────────────
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
