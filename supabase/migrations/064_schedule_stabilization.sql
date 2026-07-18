-- Migration 064: schedule-system stabilization
--
-- Closes three gaps found while auditing the scheduling workflow against the
-- "critical schedule stabilization" spec (the heavy machinery — atomic slot
-- locking, realtime publication, atomic reschedule, server-driven reminders —
-- was already in place from migrations 019-063; these are the remaining
-- real gaps):
--
-- 1. Past-slot booking was only ever rejected by the CLIENT comparing
--    against the device clock (lib/slotGeneration.ts / BookingModal /
--    RescheduleModal). book_appointment_slot(), reschedule_appointment_slot()
--    and is_slot_available() never checked the slot time against the
--    server's own now(), so a wrong/manipulated device clock (or a direct
--    RPC call) could book or reschedule into an already-passed slot. Added
--    a server-side `slot_start >= now() - 2min` guard to all three
--    (2-minute grace absorbs normal request latency/clock skew, and covers
--    on-demand bookings which pass p_slot_start = the current moment).
--
-- 2. chapa-webhook only released an abandoned slot_locks row via the
--    10-minute TTL sweep or the 30-minute stale-pending-payment cron — a
--    failed payment left the slot unavailable to other patients for up to
--    that long instead of "automatically" as the spec requires. Fixed in
--    supabase/functions/chapa-webhook/index.ts (release the lock and mark
--    the consultation cancelled immediately when Chapa reports failure).
--
-- 3. Reminder tiers were 30-min / 5-min; the spec explicitly calls for
--    30-min / 10-min. Renamed reminder_5_sent -> reminder_10_sent and moved
--    the second tier's window to 10 minutes before scheduled_at.

-- ── 3. Rename the 5-minute reminder tier to 10 minutes ─────────────────────
ALTER TABLE public.consultations
  RENAME COLUMN reminder_5_sent TO reminder_10_sent;

CREATE OR REPLACE FUNCTION trigger_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping';
    RETURN;
  END IF;

  -- 30-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '30 minutes'
                            AND now() + INTERVAL '31 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_30_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_30'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  -- 10-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '10 minutes'
                            AND now() + INTERVAL '11 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_10_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_10'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

-- ── 1a. is_slot_available(): reject already-passed slots ───────────────────
CREATE OR REPLACE FUNCTION public.is_slot_available(
  p_doctor_id  uuid,
  p_slot_start timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_slot_start >= now() - interval '2 minutes'
     AND NOT EXISTS (
    SELECT 1 FROM public.slot_locks
    WHERE doctor_id = p_doctor_id
      AND slot_start = p_slot_start
      AND expires_at > now()
  );
$$;

-- ── 1b. book_appointment_slot(): reject already-passed slot_start ──────────
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

-- ── 1c. reschedule_appointment_slot(): reject already-passed p_new_slot_start,
-- rename reminder_5_sent -> reminder_10_sent in the reset ──────────────────
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

  IF p_new_slot_start < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: This time slot has already passed.';
  END IF;

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
      reminder_10_sent       = false,
      notification_sent      = false
  WHERE id = p_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz) TO authenticated;
