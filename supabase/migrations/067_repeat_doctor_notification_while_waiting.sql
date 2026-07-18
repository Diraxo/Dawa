-- Migration 067: repeat the doctor notification while a request is waiting
--
-- Spec (doctor-offline-at-scheduled-time): "Notify the doctor repeatedly
-- until they respond." Today the doctor gets exactly one push/in-app
-- notification the instant a consultation becomes 'waiting_for_doctor'
-- (on_consultation_change's 'new_request' branch) — if their app is closed
-- and they never reopen it, nothing reminds them again while the patient
-- waits indefinitely (migration 062 intentionally never auto-cancels this).
--
-- Adds a lightweight per-consultation cursor (doctor_last_notified_at) and a
-- 3-minute cron sweep that re-fires the same 'new_request' notification
-- (in-app + push, reusing handle-consultation-notification unchanged) for any
-- consultation still waiting since its last notification.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS doctor_last_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.trigger_doctor_repeat_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id
    FROM   public.consultations
    WHERE  status = 'waiting_for_doctor'
      AND  COALESCE(doctor_last_notified_at, waiting_started_at) <= now() - interval '3 minutes'
  LOOP
    PERFORM public._call_consultation_notification('new_request', rec.id);
    UPDATE public.consultations SET doctor_last_notified_at = now() WHERE id = rec.id;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'carehub-doctor-repeat-notify',
  '*/3 * * * *',
  'SELECT public.trigger_doctor_repeat_notifications();'
);
