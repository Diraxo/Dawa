-- Migration 065: 5-minute reminder tier + status CHECK constraint fix
--
-- Closes two gaps found while auditing the scheduling workflow against the
-- "professional scheduling" spec:
--
-- 1. Migration 064 *renamed* reminder_5_sent -> reminder_10_sent instead of
--    adding a third tier, so a booking made 5-10 minutes before its slot
--    got no pre-start reminder at all (only the 30/10-minute windows exist,
--    both of which have already passed by the time such a booking is made).
--    The spec calls for a 5-minute-before tier distinct from the 10-minute
--    one. Re-adds reminder_5_sent as its own column and its own cron window,
--    leaving reminder_10_sent as the 10-minute tier (064's naming stands).
--
-- 2. Migration 041 rebuilt consultations_status_check (to add 'scheduled')
--    but based it off the OLDER list from before migration 040, silently
--    dropping 'missed', 'call_declined', 'doctor_missed', 'no_show' and
--    'ended_abnormally' — values that migrations 044/047/061 and app code
--    (waiting-room screens, mark_doctor_missed_consultations(),
--    mark_no_show_consultations()) still actively write. Any such UPDATE has
--    been silently failing the CHECK constraint ever since. Rebuilds the
--    constraint with the full, current status list.

-- ── 1. Re-add the 5-minute reminder tier ────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS reminder_5_sent boolean NOT NULL DEFAULT false;

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

  -- 5-minutes-before tier
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '5 minutes'
                            AND now() + INTERVAL '6 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_5_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_5'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

-- ── 2. reschedule_appointment_slot(): also reset reminder_5_sent ───────────
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
      reminder_5_sent        = false,
      notification_sent      = false
  WHERE id = p_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz) TO authenticated;

-- ── 3. Restore the full status CHECK constraint ─────────────────────────────
-- Find the CHECK constraint that covers the 'status' column specifically —
-- ILIKE '%status%' on the constraint name is not enough, since
-- consultations_payment_status_check also matches that pattern.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.consultations'::regclass
    AND con.contype  = 'c'
    AND att.attname  = 'status'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE consultations DROP CONSTRAINT ' || quote_ident(conname);
  END IF;
END;
$$;

ALTER TABLE consultations
  ADD CONSTRAINT consultations_status_check
  CHECK (status IN (
    -- legacy values (kept for existing rows)
    'pending',
    'active',
    -- workflow values
    'pending_payment',
    'scheduled',
    'waiting_for_doctor',
    'accepted',
    'in_progress',
    'completed',
    'cancelled',
    'declined',
    -- call-specific outcomes
    'missed',
    'call_declined',
    'doctor_missed',
    'no_show',
    'ended_abnormally'
  ));
