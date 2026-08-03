-- Migration: doctor_approval_ack
--
-- The "Application Approved!" banner was re-firing on every write to a
-- doctor's own doctor_profiles row (heartbeat, is_online toggle, etc.),
-- because the client only checked "is status approved", not "did the
-- transition into approved just happen, and has the doctor already seen
-- the banner". Persisting the "already acknowledged" flag client-side
-- (AsyncStorage) doesn't survive reinstall/logout/other devices, so it
-- needs to live in the DB.

ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS approval_ack boolean NOT NULL DEFAULT false;

-- Doctors approved before this migration shouldn't suddenly see a
-- first-time banner next launch — only newly-approved doctors (ack still
-- false going forward) or those approved after this point should see it.
UPDATE public.doctor_profiles SET approval_ack = true WHERE status = 'approved';
