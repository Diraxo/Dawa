-- Migration 107: Patient Notification System — Final Completion Audit
--
-- Closes the remaining gaps identified by the Phase-5 notification audit
-- (docs/audits/phase5-notification-security-audit-2026-07-31.md) that this
-- follow-up spec asked to fix. Every branch below is additive — no existing
-- notification path (scheduled/reminders/accepted/declined/completed/
-- summary/etc.) is touched except by appending a new ELSIF arm.
--
-- 1. Doctor Joined / Doctor Left (audit H2) — doctor_connected_at (migration
--    035) is already written by every consultation type's own call/chat
--    screen via hooks/useConsultationState.ts's markSelfConnected(), but no
--    trigger ever read it. Adds the symmetric doctor_left_at column (mirrors
--    patient_left_at, migration 063) and extends the existing presence
--    trigger to fire both directions for the doctor, exactly like it already
--    does for the patient.
--
-- 2. Consultation Ended Abnormally (audit M9) — mark_stale_active_
--    consultations() (migration 023) flips a heartbeat-stale session to
--    'ended_abnormally' but on_consultation_change() had no branch for it,
--    so a backgrounded/killed patient app never learned their call was
--    force-ended server-side.
--
-- 3. Doctor Delayed / scheduled doctor never comes online (audit M6) —
--    mark_running_late_consultations() (migration 084) only detected a
--    doctor occupied by *another* active consultation, not a doctor who is
--    simply offline. A scheduled booking activates to 'waiting_for_doctor'
--    the moment its time arrives regardless of is_online (queue activation
--    only guards against another concurrent consultation), so the patient
--    previously waited with no signal at all if the doctor never logged in.
--    Adds a second sweep on running_late_notified (shared with the existing
--    busy-case sweep — mutually exclusive conditions, still exactly-once,
--    and the doctor_ready follow-up notice on eventual accept covers both
--    reasons identically).
--
-- 4. Rating Reminder (audit M8) — no mechanism of any kind previously
--    existed. Adds a tracking column + a 10-minute sweep that reminds a
--    patient once, 24h after consultation completion, if they never left a
--    review.

-- ── 1a. doctor_left_at column ────────────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS doctor_left_at timestamptz NULL;

COMMENT ON COLUMN public.consultations.doctor_left_at IS
  'Set when the doctor backgrounds the app mid-call (video/phone); cleared back to NULL on return. Mirrors patient_left_at (migration 063). Never implies the consultation itself ended.';

-- ── 1b. Presence trigger: extend to the doctor's own connect/leave milestones ──
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

  IF NEW.doctor_connected_at IS NOT NULL AND OLD.doctor_connected_at IS NULL THEN
    PERFORM public._call_consultation_notification('doctor_connected', NEW.id);
  END IF;

  IF NEW.doctor_left_at IS NOT NULL AND OLD.doctor_left_at IS NULL THEN
    PERFORM public._call_consultation_notification('doctor_left', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_presence_change ON public.consultations;
CREATE TRIGGER trg_consultation_presence_change
  AFTER UPDATE OF patient_connected_at, patient_left_at, doctor_connected_at, doctor_left_at ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.on_consultation_presence_change();

-- ── 2. on_consultation_change(): add ended_abnormally branch ────────────────
-- Carried forward unchanged from migration 096 otherwise.
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

      -- cancelled_by / unseen-booking suppression (migration 096) — checked
      -- inside the edge function itself via cancelled_by, unchanged here.

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'call_declined' THEN
      PERFORM _call_consultation_notification('call_declined', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'missed' THEN
      PERFORM _call_consultation_notification('missed_call', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
      PERFORM _call_freeze_consultation_channel(NEW.id);
      PERFORM _call_consultation_notification('completed', NEW.id);

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ended_abnormally' THEN
      -- freeze-consultation-channel deliberately refuses any status other
      -- than 'completed' (its own guard) — not called here for that reason,
      -- only the notification fires.
      PERFORM _call_consultation_notification('ended_abnormally', NEW.id);

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

-- ── 3. mark_running_late_consultations(): add the "doctor never came ────────
-- online" sweep alongside the existing "doctor busy elsewhere" sweep. Both
-- share running_late_notified so each delayed consultation is only ever
-- flagged once, by whichever condition matches first — a doctor cannot be
-- simultaneously offline and actively occupied by another consultation, so
-- the two loops never double-fire for the same row.
--
-- FIXUP (pre-deploy, caught during the Phase-6 reliability pass): this
-- function's part (a) was accidentally authored against a pre-085 copy of
-- mark_running_late_consultations and so called handle-consultation-
-- notification directly with the retired 'carehub_service_role_key' vault
-- secret — the edge function only ever accepts INTERNAL_NOTIFICATION_SECRET
-- (migration 085), so every "doctor busy elsewhere" running-late push would
-- have 403'd in production. This is the exact same regression class as the
-- 085->095->101 incident. Since this migration was never applied/shipped,
-- fixed in place here rather than papering over it in a later migration:
-- part (a) now routes through _call_consultation_notification(), the single
-- choke point every other consultation-notification event already uses,
-- instead of hand-rolling its own net.http_post + secret lookup.
CREATE OR REPLACE FUNCTION public.mark_running_late_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  -- (a) Doctor occupied by another active consultation — unchanged from 084
  -- except for routing through _call_consultation_notification (see FIXUP
  -- note above).
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
    PERFORM public._call_consultation_notification('doctor_running_late', rec.id);
    UPDATE public.consultations SET running_late_notified = true WHERE id = rec.id;
  END LOOP;

  -- (b) NEW — doctor simply never came online for a scheduled slot. Queue
  -- activation (_activate_next_queued_for_doctor, migration 066) only checks
  -- for a *competing* consultation, not is_online, so an offline doctor's
  -- scheduled row still flips to 'waiting_for_doctor' right on time and then
  -- sits there indefinitely with nothing telling the patient why.
  FOR rec IN
    SELECT c.id
    FROM public.consultations c
    JOIN public.doctor_profiles dp ON dp.id = c.doctor_id
    WHERE c.status = 'waiting_for_doctor'
      AND c.is_on_demand IS NOT TRUE
      AND c.scheduled_at IS NOT NULL
      AND c.scheduled_at <= now()
      AND c.running_late_notified = false
      AND COALESCE(dp.is_online, false) = false
  LOOP
    PERFORM public._call_consultation_notification('doctor_delayed', rec.id);
    UPDATE public.consultations SET running_late_notified = true WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ── 4. Rating reminder: 24h after completion, once, if never rated ─────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS rating_reminder_sent boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.process_rating_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.id
    FROM public.consultations c
    WHERE c.status = 'completed'
      AND c.rating_reminder_sent = false
      AND COALESCE(c.ended_at, c.updated_at) <= now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.reviews r WHERE r.consultation_id = c.id
      )
  LOOP
    PERFORM public._call_consultation_notification('rating_reminder', rec.id);
    UPDATE public.consultations SET rating_reminder_sent = true WHERE id = rec.id;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'carehub-rating-reminder',
  '*/10 * * * *',
  'SELECT public.process_rating_reminders();'
);
