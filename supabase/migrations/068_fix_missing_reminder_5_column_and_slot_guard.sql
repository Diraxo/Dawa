-- Migration 068: fix live drift — missing reminder_5_sent column + missing
-- past-slot guard on is_slot_available()
--
-- Found while auditing the scheduled-consultation workflow: migration 066
-- (already live) redeployed trigger_appointment_reminders() with a 5-minute
-- tier that reads consultations.reminder_5_sent, but migration 065 (the
-- migration that adds that column) was never actually applied to this
-- database — only its function bodies made it in via other migrations. The
-- result: every run of the `carehub-appointment-reminders` cron job (every
-- minute) has been throwing `column "reminder_5_sent" does not exist` and
-- rolling back the ENTIRE function call as one transaction — silently
-- cancelling the 30-minute and 10-minute reminder tiers too, not just the
-- 5-minute one. No scheduled-consultation reminder of any tier has been
-- delivered since 066 went live. Confirmed live via direct
-- `SELECT trigger_appointment_reminders();` — reproduced the exact error.
--
-- Also: migration 064 added the server-side past-slot guard to
-- book_appointment_slot() and reschedule_appointment_slot() but the
-- matching change to is_slot_available() never made it to this database
-- either (confirmed via pg_proc.prosrc). Bringing it in line so any caller
-- relying on is_slot_available() alone (not just the two RPCs) also rejects
-- already-passed slots.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS reminder_5_sent boolean NOT NULL DEFAULT false;

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
