-- Migration: wire_up_slot_locking
--
-- Problem: migration 019_appointment_slot_locking.sql created slot_locks +
-- book_appointment_slot()/is_slot_available() to prevent two patients from
-- booking the same doctor at the same scheduled time, but no client code
-- ever called it — BookingModal.tsx (mobile) and booking/[doctorId]/page.tsx
-- (web) both insert directly into consultations, so double-booking
-- prevention has been dead code since it was added. It also predates the
-- current status workflow (still inserted status='pending' and had no
-- platform_amount column), so it can't be called as-is.
--
-- This brings book_appointment_slot() in line with the current insert shape
-- used by both clients (status='pending_payment', payment_status='pending',
-- platform_amount) so the app can switch to calling it directly.

CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,      -- doctor_profiles.id
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 60,   -- minutes; booking slots are hourly
  p_patient_amount   numeric DEFAULT 0,
  p_doctor_amount    numeric DEFAULT 0,
  p_platform_amount  numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consultation_id uuid;
BEGIN
  -- Expire stale locks first (best-effort cleanup)
  DELETE FROM public.slot_locks WHERE expires_at < now();

  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status, payment_status,
    patient_amount, doctor_amount, platform_amount
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    p_patient_amount, p_doctor_amount, p_platform_amount
  )
  RETURNING id INTO v_consultation_id;

  -- Atomically claim the slot — raises unique_violation if already taken
  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (p_doctor_id, p_slot_start, p_slot_duration, v_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    -- Roll back the consultation insert too
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available.';
  END;

  RETURN v_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_slot_available(uuid, timestamptz) TO authenticated;

-- Cleanup abandoned locks (payment never confirmed) every 10 minutes.
SELECT cron.schedule(
  'cleanup-slot-locks',
  '*/10 * * * *',
  'DELETE FROM public.slot_locks WHERE expires_at < now()'
);
