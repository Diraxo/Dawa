-- Migration 101: fix vault-secret regression reintroduced by migration 095
--
-- Root cause (Phase 3 consultation audit, 2026-07-30, finding P3-04):
-- Migration 085 moved every DB-trigger caller of the notification edge
-- functions off the unstable 'carehub_service_role_key' vault secret onto a
-- dedicated 'internal_notification_secret', matching send-appointment-
-- notification's auth check (INTERNAL_NOTIFICATION_SECRET env var). Migration
-- 095, written later to fix the early-firing reminder-window bug, was based
-- on a pre-085 copy of trigger_appointment_notifications()/
-- trigger_appointment_reminders() and silently reintroduced the old
-- 'carehub_service_role_key' lookup via CREATE OR REPLACE FUNCTION — so every
-- "consultation starting now" push and every reminder tier has been
-- rejected with a silent 403 (net.http_post is fire-and-forget) since 095
-- was applied.
--
-- Fix: re-apply 085's 'internal_notification_secret' lookup to both
-- functions while preserving 095's corrected timing windows verbatim.
--
-- Also folds in the fix for Phase 3 finding P3-01 (High): scheduled
-- (non-on-demand) bookings had no patient-busy check anywhere, so a patient
-- could hold two simultaneously-active consultations across two different
-- doctors — this activation cron only ever checked the DOCTOR's other active
-- rows, never the PATIENT's. A patient legitimately holds many future
-- 'scheduled' rows at once, so the guard can't live at booking time (nothing
-- is active yet); it has to live here, where 'scheduled' actually flips to
-- 'waiting_for_doctor'. Added a second NOT EXISTS mirroring the doctor one,
-- scoped to the same patient across ANY doctor. A consultation that loses
-- this race simply stays 'scheduled' and is picked up by a later tick once
-- the patient's other active consultation concludes — same fail-safe retry
-- shape as the existing doctor-side guard.

CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  UPDATE consultations c
  SET status = 'waiting_for_doctor',
      waiting_started_at = c.scheduled_at
  WHERE c.status = 'scheduled'
    AND c.scheduled_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM consultations b
      WHERE b.doctor_id = c.doctor_id
        AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations e
      WHERE e.doctor_id = c.doctor_id
        AND e.id <> c.id
        AND e.status = 'scheduled'
        AND e.scheduled_at <= now()
        AND e.scheduled_at < c.scheduled_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations p
      WHERE p.patient_id = c.patient_id
        AND p.id <> c.id
        AND p.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    );

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  -- Far edge is now() itself (never announce "starting" before it actually
  -- has); near edge widened to 3 minutes so a missed tick still catches up
  -- instead of losing the notification entirely.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() - INTERVAL '3 minutes'
                            AND now()
    AND    status IN ('pending', 'waiting_for_doctor')
    AND    notification_sent = FALSE
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

-- Same P3-01 patient-busy gap exists in the immediate-activation path fired
-- when a doctor's active consultation resolves (migration 092) — it only
-- ever checked the doctor's other active rows, never the patient's, so a
-- patient already active elsewhere could be immediately promoted into a
-- second live consultation the instant a different doctor's prior session
-- ends (rather than waiting for the next per-minute cron tick).
CREATE OR REPLACE FUNCTION public._activate_next_queued_for_doctor(p_doctor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('carehub.system_status_write', 'on', true);

  UPDATE public.consultations c
  SET status             = 'waiting_for_doctor',
      waiting_started_at  = c.scheduled_at
  WHERE c.doctor_id = p_doctor_id
    AND c.status = 'scheduled'
    AND c.scheduled_at <= now()
    -- doctor must not already be occupied by (or waiting on) another consultation
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations b
      WHERE b.doctor_id = p_doctor_id
        AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    )
    -- only the earliest-due overdue appointment may activate — never skip ahead
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations e
      WHERE e.doctor_id = p_doctor_id
        AND e.id <> c.id
        AND e.status = 'scheduled'
        AND e.scheduled_at <= now()
        AND e.scheduled_at < c.scheduled_at
    )
    -- patient must not already be active in a different consultation (P3-01)
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations p
      WHERE p.patient_id = c.patient_id
        AND p.id <> c.id
        AND p.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    );

  PERFORM set_config('carehub.system_status_write', 'off', true);
END;
$$;

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
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  -- 30-minutes-before tier — far edge is exactly the 30-minute mark (never
  -- early); near edge gives a 3-minute catch-up window for a delayed tick.
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '27 minutes'
                            AND now() + INTERVAL '30 minutes'
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
    WHERE  scheduled_at BETWEEN now() + INTERVAL '7 minutes'
                            AND now() + INTERVAL '10 minutes'
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

  -- 5-minutes-before tier — only for bookings made <10 minutes before their
  -- own slot (never got a real chance at the 30/10-minute windows above).
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '2 minutes'
                            AND now() + INTERVAL '5 minutes'
    AND    status IN ('pending', 'scheduled', 'waiting_for_doctor')
    AND    reminder_5_sent = FALSE
    AND    (scheduled_at - created_at) < INTERVAL '10 minutes'
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
