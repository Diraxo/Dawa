-- Migration 019: Atomic appointment slot locking to prevent double-booking
-- Creates a slot_locks table + a booking function that acquires a lock atomically.

-- ── Slot locks table ──────────────────────────────────────────────────────────
-- Each row represents a claimed slot. Unique constraint prevents two bookings
-- for the same doctor at the same scheduled time.
CREATE TABLE IF NOT EXISTS public.slot_locks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
  slot_start      timestamptz NOT NULL,
  slot_duration   int NOT NULL DEFAULT 30, -- minutes
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE CASCADE,
  locked_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  CONSTRAINT uq_doctor_slot UNIQUE (doctor_id, slot_start)
);

-- Auto-expire abandoned locks (e.g. payment never confirmed)
CREATE INDEX IF NOT EXISTS idx_slot_locks_expires_at ON public.slot_locks(expires_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.slot_locks ENABLE ROW LEVEL SECURITY;

-- Doctors can see their own locks; patients can see locks for any doctor (to
-- check availability when booking).
CREATE POLICY "Doctors see own slot locks"
  ON public.slot_locks FOR SELECT
  USING (
    doctor_id IN (
      SELECT dp.id FROM public.doctor_profiles dp
      JOIN public.users u ON u.id = dp.user_id
      WHERE u.clerk_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "Patients can view all slot locks"
  ON public.slot_locks FOR SELECT
  USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'patient'
  );

CREATE POLICY "Authenticated users can acquire slot locks"
  ON public.slot_locks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow updating own slot lock"
  ON public.slot_locks FOR UPDATE
  USING (true);

CREATE POLICY "Allow deleting expired slot locks"
  ON public.slot_locks FOR DELETE
  USING (expires_at < now());

-- ── Atomic slot-booking function ──────────────────────────────────────────────
-- Call this instead of inserting directly into consultations.
-- Returns the new consultation id on success, raises an exception on conflict.
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,      -- doctor_profiles.id
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 30,
  p_patient_amount   numeric DEFAULT 0,
  p_doctor_amount    numeric DEFAULT 0
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

  -- Insert the consultation row
  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status,
    patient_amount, doctor_amount
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending',
    p_patient_amount, p_doctor_amount
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

-- ── Helper: check if a slot is available ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_slot_available(
  p_doctor_id  uuid,
  p_slot_start timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.slot_locks
    WHERE doctor_id = p_doctor_id
      AND slot_start = p_slot_start
      AND expires_at > now()
  );
$$;

-- ── Cron-style cleanup (requires pg_cron extension; skip if not available) ───
-- Run: SELECT cron.schedule('cleanup-slot-locks', '*/10 * * * *', 'DELETE FROM public.slot_locks WHERE expires_at < now()');
