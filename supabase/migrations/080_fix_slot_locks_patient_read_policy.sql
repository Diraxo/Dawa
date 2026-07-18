-- Migration: fix_slot_locks_patient_read_policy
--
-- Problem (Issue 3 — "booked slots remain clickable"): the "Patients can view
-- all slot locks" policy (019_appointment_slot_locking.sql) checks
-- request.jwt.claims->>'role' = 'patient'. Clerk-issued JWTs never carry a
-- top-level 'role' claim — role is a column on public.users, looked up via
-- the 'sub' claim -> clerk_id, exactly like every other RLS policy in this
-- codebase (including "Doctors see own slot locks" right above it). This is
-- the only policy in the entire migration history built on a JWT 'role'
-- claim, and it has therefore never matched any real patient session.
--
-- Verified live: 12 active slot_locks rows exist, but a simulated real
-- patient session (a genuine clerk_id, sub-only claims, no role claim) sees
-- 0 of them. BookingModal/RescheduleModal's slot_locks SELECT + realtime
-- subscription have always silently returned empty for patients, so a
-- booked slot never rendered as booked/disabled — the doctor's client
-- correctly sees blocked (rows for their own doctor_id), but every patient
-- client sees every slot as available until book_appointment_slot()/
-- reschedule_appointment_slot() rejects it server-side with SLOT_TAKEN.
--
-- Fix: this data (doctor_id + slot start/duration, no patient identity) is
-- not sensitive — any authenticated app user (patient or doctor) may read it,
-- matching the INSERT policy's "Authenticated users can acquire slot locks".

DROP POLICY IF EXISTS "Patients can view all slot locks" ON public.slot_locks;

CREATE POLICY "Authenticated users can view all slot locks"
  ON public.slot_locks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.clerk_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );
