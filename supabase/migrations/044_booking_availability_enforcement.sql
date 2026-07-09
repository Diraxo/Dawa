-- Migration: booking_availability_enforcement
--
-- Problem: several booking-integrity checks only ever existed client-side
-- (or not at all), so they could be silently bypassed:
--
--   1. "On-Demand"/"Accept Scheduled" toggles (doctor_profiles.availability
--      ->> 'acceptOnDemand' / 'acceptScheduled') were saved by the doctor
--      schedule UI but never read by book_appointment_slot() or either
--      client's patient-booking flow — a doctor disabling on-demand had no
--      effect; patients could still tap "Start Now".
--   2. A day marked OFF (availability->'<Day>'->>'enabled' = false) or a
--      blocked_dates entry was only filtered out of the *displayed* slot
--      list; nothing stopped a request for that day/slot from reaching the
--      RPC and succeeding.
--   3. slot_locks' unique (doctor_id, slot_start) constraint only protects
--      bookings that go through book_appointment_slot() — the RLS policy on
--      consultations still permits any authenticated patient to INSERT
--      directly, bypassing slot locking entirely.
--
-- This migration adds server-side enforcement for (1) and (2) inside
-- book_appointment_slot(), and a DB-level partial unique index for (3) that
-- holds regardless of which code path performed the insert.

-- CREATE OR REPLACE does not replace a function whose parameter list differs
-- in arity/types — it creates a second overload. Drop the previous 8-param
-- signature explicitly so callers can't accidentally still hit the old,
-- unenforced version.
DROP FUNCTION IF EXISTS public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,      -- doctor_profiles.id
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 60,   -- minutes; booking slots are hourly
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
  v_accept_on_demand boolean;
  v_accept_scheduled boolean;
  v_day_key          text;
  v_day_cfg          jsonb;
  v_blocked          jsonb;
  v_date_str         text;
BEGIN
  -- Expire stale locks first (best-effort cleanup)
  DELETE FROM public.slot_locks WHERE expires_at < now();

  SELECT availability INTO v_avail FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_avail IS NOT NULL THEN
    v_accept_on_demand := COALESCE((v_avail->>'acceptOnDemand')::boolean, true);
    v_accept_scheduled := COALESCE((v_avail->>'acceptScheduled')::boolean, true);

    IF p_is_on_demand THEN
      IF NOT v_accept_on_demand THEN
        RAISE EXCEPTION 'ON_DEMAND_DISABLED: This doctor is not accepting on-demand consultations right now.';
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
    END IF;
  END IF;

  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status, payment_status,
    patient_amount, doctor_amount, platform_amount
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    p_patient_amount, p_doctor_amount, p_platform_amount
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

-- Defense-in-depth: guarantee (doctor_id, scheduled_at) uniqueness at the
-- table level for any consultation that's actually occupying the doctor's
-- calendar, independent of whether the insert went through
-- book_appointment_slot()/slot_locks at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_doctor_slot
  ON public.consultations (doctor_id, scheduled_at)
  WHERE status NOT IN ('cancelled', 'declined', 'call_declined', 'no_show', 'missed', 'doctor_missed', 'ended_abnormally');
