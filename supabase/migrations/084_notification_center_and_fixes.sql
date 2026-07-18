-- Migration 084: Notification Center + reliability fixes
--
-- Closes gaps found during the full mobile notification-system audit:
--
-- 1. "Doctor running late" / "Doctor is ready" (spec section 6) — no code
--    anywhere detected a doctor still occupied when a scheduled consultation's
--    time arrives, so a waiting patient never got a "running behind" notice,
--    and never got a distinct "ready now" notice either (only the generic
--    doctor-facing new_request event exists). Adds a tracking column, a cron
--    sweep that fires the one-time "running late" notice, and a trigger
--    branch that fires the one-time "ready" notice exactly when the queue
--    finally activates this consultation (migration 066's
--    _activate_next_queued_for_doctor).
--
-- 2. Doctor "new request" notification stacking (spec section 12) — the
--    3-minute repeat cron (migration 067) calls the same new_request handler
--    on every tick, which did a plain INSERT each time. Tags repeat calls so
--    the edge function can refresh the existing row's timestamp instead of
--    inserting a duplicate.

-- ── 1. Running-late tracking column ──────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS running_late_notified boolean NOT NULL DEFAULT false;

-- ── 2. Cron sweep: notify the waiting patient once when their doctor is ──────
-- still occupied by another consultation at/after the scheduled time. Mirrors
-- _activate_next_queued_for_doctor's own busy check (migration 066) so this
-- fires exactly for the rows that check blocks from activating.
CREATE OR REPLACE FUNCTION public.mark_running_late_consultations()
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

  FOR rec IN
    SELECT c.id
    FROM public.consultations c
    WHERE c.status = 'scheduled'
      AND c.scheduled_at <= now()
      AND c.running_late_notified = false
      AND EXISTS (
        SELECT 1 FROM public.consultations b
        WHERE b.doctor_id = c.doctor_id
          AND b.id <> c.id
          AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
      )
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-consultation-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('event', 'doctor_running_late', 'consultation_id', rec.id::text),
      timeout_milliseconds := 10000
    );

    UPDATE public.consultations SET running_late_notified = true WHERE id = rec.id;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'carehub-running-late-check',
  '* * * * *',
  'SELECT public.mark_running_late_consultations();'
);

-- ── 3. "Doctor is ready" — fires once, exactly when a previously-delayed ────
-- consultation is finally activated by the queue (migration 066's
-- _activate_next_queued_for_doctor / trigger_appointment_notifications), not
-- on every ordinary activation. Carried forward unchanged from migration 066
-- otherwise.
CREATE OR REPLACE FUNCTION public.on_consultation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'waiting_for_doctor' THEN
      PERFORM _call_consultation_notification('new_request', NEW.id);
      IF OLD.running_late_notified = true THEN
        PERFORM _call_consultation_notification('doctor_ready', NEW.id);
      END IF;

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

-- ── 4. Repeat doctor-notify: tag as a refresh, not a fresh alert ────────────
-- The edge function's new_request handler checks payload.repeat and, when
-- true, updates the existing notifications row's timestamp instead of
-- inserting a new one — closes the "5 stacked rows for one unanswered
-- 15-minute request" gap.
CREATE OR REPLACE FUNCTION public.trigger_doctor_repeat_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id FROM public.consultations
    WHERE status = 'waiting_for_doctor'
      AND COALESCE(doctor_last_notified_at, waiting_started_at) <= now() - interval '3 minutes'
  LOOP
    PERFORM public._call_consultation_notification('new_request', rec.id, jsonb_build_object('repeat', true));
    UPDATE public.consultations SET doctor_last_notified_at = now() WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ── 5. Unread-count lookups (badge, Notification Center) are now a hot path ──
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id)
  WHERE read_at IS NULL;
