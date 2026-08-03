-- Migration: doctor_presence_heartbeat
--
-- Problem: doctor_profiles.is_online has no expiry mechanism. A doctor whose
-- app crashes, is force-quit, or loses connectivity while online stays
-- "online" in the DB forever — the mobile AppState background handler
-- (app/(doctor)/_layout.tsx) and logout handler cover the graceful-exit
-- cases, but neither runs on a crash or force-quit. This adds a heartbeat
-- column + server-side TTL cleanup as the safety net, mirroring the existing
-- consultations.last_heartbeat_at pattern from migration 023.

ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_doctor_profiles_online_last_seen
  ON public.doctor_profiles (is_online, last_seen_at)
  WHERE is_online = true;

-- Runs every minute. A doctor toggled online but with no heartbeat (or a
-- heartbeat older than 2 minutes — well past the 60s client ping interval)
-- is force-flipped offline — unless they're inside an active consultation
-- (accepted/in_progress, same definition as is_doctor_busy() from migration
-- 047), in which case they're left alone: a doctor mid-call may have their
-- client heartbeat lapse (backgrounded app, brief connectivity drop) without
-- actually being gone, and flipping them offline mid-consultation would be
-- visibly wrong to the patient for no correctness benefit — the busy check
-- already blocks new bookings independently of is_online.
CREATE OR REPLACE FUNCTION mark_stale_doctors_offline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.doctor_profiles dp
  SET is_online = false
  WHERE dp.is_online = true
    AND (dp.last_seen_at IS NULL OR dp.last_seen_at < now() - INTERVAL '2 minutes')
    AND NOT EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.doctor_id = dp.id
        AND c.status IN ('accepted', 'in_progress')
    );
END;
$$;

SELECT cron.schedule(
  'mark-stale-doctors-offline',
  '* * * * *',
  'SELECT mark_stale_doctors_offline()'
);
