-- Migration: reschedule_and_scheduled_notifications
--
-- Fixes three related gaps in the scheduled-appointment flow:
--
-- 1. Timezone bug in book_appointment_slot(): EXTRACT(...FROM p_slot_start)
--    and to_char(p_slot_start, ...) implicitly convert the timestamptz using
--    the DB session's timezone (UTC on Supabase by default), while
--    doctor_profiles.availability startTime/endTime strings and every
--    client's slot generation assume local Africa/Addis_Ababa wall-clock
--    time. Nothing anywhere in this codebase ever normalizes the timezone,
--    causing systematic false OUTSIDE_HOURS/DAY_OFF/DATE_BLOCKED
--    rejections (or, symmetrically, false acceptances) near the UTC/local
--    boundary. Fixed by converting p_slot_start to local time before any
--    EXTRACT/to_char call. The shared day-off/blocked-date/working-hours
--    validation is factored into _validate_scheduled_slot() so the fix
--    lives in exactly one place and the new reschedule RPC below reuses it
--    instead of re-implementing (and potentially re-diverging on) the same
--    logic.
--
-- 2. No reschedule RPC exists — the only way to change a booked time was to
--    cancel the row and create a brand-new one via book_appointment_slot,
--    which re-triggers payment/credit logic and loses the original slot
--    lock atomicity guarantee. reschedule_appointment_slot() updates the
--    existing consultation row in place (preserving its id, payment status,
--    and consultation type), re-validates the new slot with the same rules
--    as booking, and atomically moves the slot_locks row.
--
-- 3. on_consultation_change() never fired a notification when a booking
--    reached status='scheduled', and has no concept of a reschedule event.
--    Two new trigger branches call the existing handle-consultation-notification
--    edge function (via _call_consultation_notification, migration 007) with
--    new event kinds 'scheduled_booking' and 'rescheduled'.

-- ── previous_scheduled_at: lightweight audit trail for reschedules ──────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS previous_scheduled_at timestamptz;

-- ── Shared slot validation (day-off / blocked-date / working-hours) ─────────
-- Only called for scheduled (non-on-demand) bookings when the doctor has
-- configured availability. Raises on failure, otherwise returns silently.
CREATE OR REPLACE FUNCTION public._validate_scheduled_slot(
  p_avail         jsonb,
  p_slot_start    timestamptz,
  p_slot_duration int
)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local_ts        timestamptz;
  v_day_key         text;
  v_day_cfg         jsonb;
  v_blocked         jsonb;
  v_date_str        text;
  v_start_mins      int;
  v_end_mins        int;
  v_slot_start_mins int;
BEGIN
  -- Normalize to local wall-clock time before deriving day-of-week, date,
  -- or minutes-since-midnight — doctor_profiles.availability and every
  -- client's slot generation are both local-time-implicit with no offset
  -- marker, so the server must localize too or its checks drift from what
  -- the client actually offered.
  v_local_ts := p_slot_start AT TIME ZONE 'Africa/Addis_Ababa';

  v_day_key := CASE EXTRACT(DOW FROM v_local_ts)
    WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
    WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
  END;
  v_day_cfg := p_avail -> v_day_key;
  IF v_day_cfg IS NULL OR COALESCE((v_day_cfg->>'enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'DAY_OFF: This doctor is not available on %.', v_day_key;
  END IF;

  v_blocked := COALESCE(p_avail->'blocked_dates', '[]'::jsonb);
  v_date_str := to_char(v_local_ts, 'YYYY-MM-DD');
  IF v_blocked ? v_date_str THEN
    RAISE EXCEPTION 'DATE_BLOCKED: This doctor is unavailable on the selected date.';
  END IF;

  v_start_mins := _parse_time_to_minutes(v_day_cfg->>'startTime');
  v_end_mins   := _parse_time_to_minutes(v_day_cfg->>'endTime');
  IF v_start_mins IS NOT NULL AND v_end_mins IS NOT NULL THEN
    v_slot_start_mins := EXTRACT(HOUR FROM v_local_ts)::int * 60 + EXTRACT(MINUTE FROM v_local_ts)::int;
    IF v_slot_start_mins < v_start_mins OR v_slot_start_mins + p_slot_duration > v_end_mins THEN
      RAISE EXCEPTION 'OUTSIDE_HOURS: This time is outside the doctor''s working hours (% - %).',
        v_day_cfg->>'startTime', v_day_cfg->>'endTime';
    END IF;
  END IF;
END;
$$;

-- ── book_appointment_slot(): now delegates to _validate_scheduled_slot() ────
-- Same 9-arg signature as migration 050 — CREATE OR REPLACE in place.
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

  SELECT availability INTO v_avail FROM public.doctor_profiles WHERE id = p_doctor_id;

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

-- ── reschedule_appointment_slot(): move an existing scheduled booking ───────
-- Updates the consultation row in place (same id, payment_status, type) —
-- does NOT cancel + recreate. Only the owning patient may call it, and only
-- while the row is still status='scheduled'. Re-runs the exact same
-- day-off/blocked-date/working-hours validation as booking, then atomically
-- moves the slot_locks row (insert-new-before-delete-old so a SLOT_TAKEN
-- failure never leaves the appointment without any lock at all).
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

  SELECT availability INTO v_avail FROM public.doctor_profiles WHERE id = v_row.doctor_id;
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

  -- Claim the new slot first — if this raises SLOT_TAKEN, the old lock (and
  -- the original booking) is untouched.
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

-- ── on_consultation_change(): add scheduled-booking + reschedule events ─────
-- Carries forward every existing branch from migration 040 unchanged, adds
-- two new ones at the end.
CREATE OR REPLACE FUNCTION public.on_consultation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'declined' THEN
      PERFORM _call_consultation_notification('declined', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
      PERFORM _call_consultation_notification('cancelled', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'call_declined' THEN
      PERFORM _call_consultation_notification('call_declined', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'missed' THEN
      PERFORM _call_consultation_notification('missed_call', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
      PERFORM _call_freeze_consultation_channel(NEW.id);

    ELSIF NEW.status = 'pending'
       AND NEW.payment_status = 'paid'
       AND NEW.waiting_started_at IS NOT NULL
       AND (
         OLD.payment_status IS DISTINCT FROM NEW.payment_status
         OR OLD.waiting_started_at IS DISTINCT FROM NEW.waiting_started_at
       )
    THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' THEN
      PERFORM _call_consultation_notification('accepted', NEW.id);

    -- Patient paid for a future appointment -> confirm to patient + notify doctor
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'scheduled' THEN
      PERFORM _call_consultation_notification('scheduled_booking', NEW.id);

    -- Patient moved an already-scheduled appointment to a new time
    ELSIF OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at AND NEW.status = 'scheduled' THEN
      PERFORM _call_consultation_notification('rescheduled', NEW.id);

    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
