-- Migration 073: persist is_on_demand on consultations instead of re-deriving
-- it from timing heuristics at every call site
--
-- Root cause of the "scheduled booking made <1h ahead lands the patient in
-- the waiting room" bug: book_appointment_slot() has always accepted
-- p_is_on_demand as a parameter but only ever used it transiently to decide
-- which validation branch to run — it was never written to the row. Every
-- downstream caller that needs to know "is this consultation on-demand or
-- scheduled" (carehub-web/app/patient/payment/return/page.tsx,
-- app/(patient)/payment-return.tsx, supabase/functions/apply-credit) had to
-- re-guess it from `scheduled_at`, and independently landed on
-- `scheduled_at > now() + 1 hour` ⇒ 'schedule', else 'now'. That threshold is
-- wrong for any scheduled slot booked less than an hour ahead of its start
-- time (very common with 20-minute slot granularity) — it gets misclassified
-- as on-demand, which flips status to 'waiting_for_doctor' and auto-redirects
-- the patient into the on-demand waiting room for an appointment that hasn't
-- started yet. supabase/functions/chapa-webhook/index.ts already worked
-- around this independently with a *different*, more accurate heuristic
-- (scheduled_at within ~1 minute of created_at ⇒ on-demand), proving the two
-- heuristics can disagree for the same row. Fix: store the flag once, at the
-- only place that actually knows it for certain (book_appointment_slot's
-- caller-supplied p_is_on_demand), and have every reader use that column
-- instead of guessing.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS is_on_demand boolean;

-- Backfill existing rows using the same proximity heuristic chapa-webhook
-- already relied on (scheduled_at was stamped to the booking moment itself
-- for on-demand bookings) — best-effort, for historical consistency only;
-- nothing downstream depends on backfilled rows being exactly right.
UPDATE public.consultations
SET is_on_demand = (abs(extract(epoch FROM (scheduled_at - created_at))) < 60)
WHERE is_on_demand IS NULL
  AND scheduled_at IS NOT NULL
  AND created_at IS NOT NULL;

-- book_appointment_slot(): same signature as migration 069 (CREATE OR
-- REPLACE in place) — only change is persisting p_is_on_demand onto the
-- inserted row.
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
  v_doctor_soon      boolean;
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

    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE doctor_id = p_doctor_id
        AND status = 'scheduled'
        AND scheduled_at <= now() + interval '20 minutes'
    ) INTO v_doctor_soon;

    IF v_doctor_soon THEN
      RAISE EXCEPTION 'DOCTOR_SCHEDULED_SOON: This doctor has a scheduled appointment starting soon and cannot accept an on-demand consultation right now.';
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
    patient_amount, doctor_amount, platform_amount,
    is_on_demand
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    p_patient_amount, v_doctor_amount, v_platform_amount,
    p_is_on_demand
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
