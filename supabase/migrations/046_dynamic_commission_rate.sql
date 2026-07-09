-- Migration: dynamic_commission_rate
--
-- Problem: the doctor/platform revenue split was hardcoded to 80/20 on both
-- clients (BookingModal.tsx on mobile, the web booking page) and sent to
-- book_appointment_slot() as plain numeric arguments. The admin dashboard's
-- "Platform Commission Rate" setting (platform_settings.commission_rate) was
-- never read by either client, so changing it there had no effect on:
--   1. What doctors actually get credited (doctor_amount) when a booking is
--      created — it stayed at a hardcoded 80%.
--   2. The "Earnings Preview" shown during doctor registration and on the
--      doctor's pricing screen — both hardcoded a 20% fee.
-- It also meant an authenticated client could pass any p_doctor_amount /
-- p_platform_amount it wanted directly to the RPC, since the server never
-- validated them against the actual patient_amount.
--
-- Fix: book_appointment_slot() now computes doctor_amount/platform_amount
-- itself from platform_settings.commission_rate and p_patient_amount,
-- ignoring whatever the client passes for p_doctor_amount/p_platform_amount
-- (kept as accepted-but-unused parameters so existing callers don't break).
-- A SECURITY DEFINER get_commission_rate() function is added so clients can
-- read just the commission percentage (for display purposes, e.g. earnings
-- previews) without needing admin-only access to the rest of platform_settings.

CREATE OR REPLACE FUNCTION public.get_commission_rate()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value::text::numeric FROM public.platform_settings WHERE key = 'commission_rate'),
    20
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_commission_rate() TO anon, authenticated;

-- CREATE OR REPLACE keeps the existing 9-param signature from migration 045 —
-- same arity/types, so this replaces it in place rather than overloading.
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,      -- doctor_profiles.id
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 60,   -- minutes; booking slots are hourly
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
