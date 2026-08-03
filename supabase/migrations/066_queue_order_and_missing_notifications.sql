-- Migration 066: strict queue ordering + missing notification events
--
-- Closes gaps found auditing the full scheduling/consultation workflow spec
-- against the current implementation:
--
-- 1. QUEUE ORDERING (spec sections 1, 7, 8, 17): trigger_appointment_notifications()
--    (migration 041) flips EVERY overdue 'scheduled' row to 'waiting_for_doctor'
--    purely on scheduled_at <= now(), with no regard for whether the same
--    doctor already has an earlier, still-unresolved consultation. So if
--    appointment A (10:40) runs past B's slot (11:00), B was activated (and
--    the patient notified/put in the waiting room) at 11:00 anyway — only the
--    later ACCEPT step was guarded (migration 061's DOCTOR_BUSY check), not
--    activation itself. Fixed by only activating the earliest overdue
--    'scheduled' row for a doctor that has no other row currently
--    waiting_for_doctor/accepted/in_progress. Symmetrically, the instant an
--    active consultation resolves (completed/declined/cancelled/missed/etc.),
--    a new trigger immediately promotes the next queued appointment instead
--    of waiting up to a minute for the next cron tick.
--
-- 2. Missing patient notification: "consultation completed" — on_consultation_change()
--    only called _call_freeze_consultation_channel() on completion, never
--    _call_consultation_notification(). Patients only ever learned via
--    summary_ready, which fires separately (and later) when the doctor
--    submits notes.
--
-- 3. Missing doctor notifications: "patient joined" / "patient left" —
--    patient_connected_at (migration 035) and patient_left_at (migration 063)
--    are both plain column writes with no trigger firing a notification
--    event, so a doctor whose app is backgrounded/closed never learns either
--    happened (only visible live via Realtime on an already-open call screen).
--
-- 4. The 5-minute reminder tier (migration 065) fires unconditionally for
--    every appointment. Spec: "5 minutes before (only if appointment is less
--    than 10 minutes away when booked)" — i.e. only for last-minute bookings
--    that never had a chance to see the 30/10-minute windows. Gated the tier
--    on (scheduled_at - created_at) < 10 minutes.

-- ── 1a. Shared helper: activate the next queued appointment for one doctor ──
CREATE OR REPLACE FUNCTION public._activate_next_queued_for_doctor(p_doctor_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
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
    );
$$;

-- ── 1b. Cron activation: same guard, applied to all doctors at once ─────────
CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  -- waiting_started_at must be stamped to scheduled_at (not now()) here —
  -- it is the sort key doctor clients queue on (earliest first), so a
  -- consultation's queue position must reflect its booked time, not the
  -- moment the cron happened to run.
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
    );

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'carehub_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() - INTERVAL '30 seconds'
                            AND now() + INTERVAL '30 seconds'
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

-- ── 1c. Immediate promotion the instant a consultation resolves ─────────────
-- Avoids waiting up to a minute for the next cron tick after the doctor
-- finishes/declines/the patient cancels — "Patient B becomes waiting_for_doctor"
-- should follow "Patient A finishes" right away.
CREATE OR REPLACE FUNCTION public.on_consultation_resolved_activate_next()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
     AND NEW.status NOT IN ('waiting_for_doctor', 'accepted', 'in_progress')
  THEN
    PERFORM public._activate_next_queued_for_doctor(NEW.doctor_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_resolved_activate_next ON public.consultations;
CREATE TRIGGER trg_consultation_resolved_activate_next
  AFTER UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.on_consultation_resolved_activate_next();

-- ── 2 & (carry-forward). on_consultation_change(): add 'completed' patient
-- notification alongside the existing channel-freeze call. Every other
-- branch is carried forward unchanged from migration 054. ─────────────────
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
      PERFORM _call_consultation_notification('completed', NEW.id);

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

-- ── 3. Doctor notifications: patient joined / patient left ──────────────────
CREATE OR REPLACE FUNCTION public.on_consultation_presence_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.patient_connected_at IS NOT NULL AND OLD.patient_connected_at IS NULL THEN
    PERFORM public._call_consultation_notification('patient_joined', NEW.id);
  END IF;

  IF NEW.patient_left_at IS NOT NULL AND OLD.patient_left_at IS NULL THEN
    PERFORM public._call_consultation_notification('patient_left', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_presence_change ON public.consultations;
CREATE TRIGGER trg_consultation_presence_change
  AFTER UPDATE OF patient_connected_at, patient_left_at ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.on_consultation_presence_change();

-- ── 4. 5-minute reminder tier: only for bookings made <10 minutes before
-- their own slot (spec: "only if appointment is less than 10 minutes away
-- when booked") — not a blanket tier for every appointment. ─────────────────
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

  -- 5-minutes-before tier — only for bookings made <10 minutes before their
  -- own slot (never got a real chance at the 30/10-minute windows above).
  FOR rec IN
    SELECT id
    FROM   consultations
    WHERE  scheduled_at BETWEEN now() + INTERVAL '5 minutes'
                            AND now() + INTERVAL '6 minutes'
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
