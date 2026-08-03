-- Migration: enforce_working_hours
--
-- Problem: book_appointment_slot() (migration 044) validates the
-- acceptOnDemand/acceptScheduled toggles, day-off, and blocked_dates — but
-- never checks the requested slot against the doctor's configured
-- startTime/endTime window for that day. The clients (BookingModal.tsx on
-- mobile, the web booking page) only ever *offer* slots inside that window in
-- their UI, but nothing on the server stopped a direct RPC/API call (or a
-- future client bug) from booking any time on a day that's merely enabled —
-- e.g. a doctor open 9:00 AM - 8:05 PM could still be booked for 11:00 PM.
-- This closes that gap with a real server-side check.

-- ── Helper: "9:00 AM" / "08:05 PM" → minutes since midnight ─────────────────
-- Returns NULL (rather than raising) on unparseable input so a malformed or
-- missing startTime/endTime degrades to "no window enforced" instead of
-- blocking every booking for that doctor.
CREATE OR REPLACE FUNCTION _parse_time_to_minutes(p_time text)
RETURNS int
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ts timestamptz;
BEGIN
  IF p_time IS NULL OR btrim(p_time) = '' THEN RETURN NULL; END IF;
  v_ts := to_timestamp(p_time, 'HH12:MI AM');
  RETURN EXTRACT(HOUR FROM v_ts)::int * 60 + EXTRACT(MINUTE FROM v_ts)::int;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- CREATE OR REPLACE keeps the existing 9-param signature from migration 044 —
-- same arity/types, so this replaces it in place rather than overloading.
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
  v_start_mins       int;
  v_end_mins         int;
  v_slot_start_mins  int;
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
