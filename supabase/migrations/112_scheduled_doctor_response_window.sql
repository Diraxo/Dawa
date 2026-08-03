-- Migration 112: bounded doctor response window for SCHEDULED consultations
--
-- Migration 062 removed the old fixed-countdown "doctor_missed" sweep because
-- it applied to every waiting_for_doctor row, including on-demand requests,
-- where a paid patient sitting in the waiting room must never be silently
-- auto-cancelled ("the waiting room must never disappear on its own").
-- Migration 067 replaced it with an indefinite 3-minute re-ping instead.
--
-- For a *scheduled* booking (fixed 20-minute slot, is_on_demand = false) that
-- policy has a real gap: nothing ever ends the wait, so a doctor who never
-- opens the app has their scheduled slot re-pinged forever, and — per
-- hooks/useActiveConsultationRecovery.ts + app/(doctor)/(tabs)/home.tsx,
-- both of which key off status = 'waiting_for_doctor' with no age check — the
-- doctor cold-launching the app the *next day* sees yesterday's booking
-- surfaced as a live, ringing incoming consultation.
--
-- This adds a 5-minute response window that applies ONLY to scheduled
-- bookings (is_on_demand IS NOT TRUE), mirroring the scoping already used by
-- migration 107's "doctor never came online" sweep. On-demand requests are
-- untouched — migration 062's guarantee for the on-demand waiting room still
-- holds.
--
-- 'doctor_missed' already exists in the status CHECK constraint (migration
-- 065) and is already handled as a terminal status everywhere on the client
-- (hooks/useConsultationState.ts TERMINAL_STATUSES, app/_layout.tsx
-- GHOST_TERMINAL_STATUSES, doctor consultations tab status-pill map) — it was
-- simply never reachable since 062 dropped the only writer. The one missing
-- piece is app/(patient)/waiting-room.tsx, which never had a branch for it
-- even before 062 (fixed in the same commit as this migration).

-- ── 1. Credit issuance also covers doctor_missed (re-adds the branch 062
-- reverted, since nothing could reach it until now) ─────────────────────────
CREATE OR REPLACE FUNCTION public.set_consultation_credit_on_decline()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(NEW.payment_status, OLD.payment_status) = 'paid'
     AND NOT COALESCE(NEW.consultation_credit, false)
     AND (
       NEW.status = 'declined'
       OR NEW.status = 'doctor_missed'
       OR (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor'))
     )
  THEN
    NEW.consultation_credit := true;
    NEW.credit_amount := COALESCE(NEW.patient_amount, OLD.patient_amount, 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Sweep: end a scheduled booking's response window after 5 minutes ────
CREATE OR REPLACE FUNCTION public.mark_doctor_missed_scheduled_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.consultations
  SET
    status     = 'doctor_missed',
    ended_at   = now(),
    updated_at = now()
  WHERE status         = 'waiting_for_doctor'
    AND is_on_demand   IS NOT TRUE
    AND scheduled_at   IS NOT NULL
    AND payment_status = 'paid'
    AND waiting_started_at IS NOT NULL
    AND waiting_started_at < now() - interval '5 minutes';
END;
$$;

SELECT cron.schedule(
  'mark-doctor-missed-scheduled',
  '* * * * *',
  'SELECT public.mark_doctor_missed_scheduled_consultations();'
);

-- ── 3. on_consultation_change(): notify on doctor_missed ────────────────────
-- Carried forward unchanged from migration 107 otherwise.
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

    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'doctor_missed' THEN
      PERFORM _call_consultation_notification('doctor_missed', NEW.id);

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
