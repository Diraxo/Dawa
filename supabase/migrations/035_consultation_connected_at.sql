-- ── Consultation connection-state single source of truth ─────────────────────
--
-- Problem: doctor/patient clients each independently inferred "the other party
-- is connected" from local Agora SDK events, and whichever side observed the
-- other's media first wrote status='in_progress'/started_at=now() to the DB.
-- This is an asymmetric, racy write: the other party only learns about it via
-- Realtime, and if that lags, the two clients can visibly disagree about call
-- state and elapsed time.
--
-- Fix: each party now reports only ITS OWN connection milestone. A trigger
-- performs the "both connected -> in_progress" transition atomically and
-- exactly once, so both clients observe the same status/started_at change via
-- the existing Realtime subscription on this table (REPLICA IDENTITY FULL,
-- enabled in migrations 022/023).

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS doctor_connected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS patient_connected_at TIMESTAMPTZ;

-- doctor_connected_at / patient_connected_at are write-once milestones ("this
-- party completed its initial join+publish handshake for this consultation").
-- They are never reset on reconnect/rejoin — live reconnect health stays
-- driven entirely by Agora's own peer-presence signal on each client, as
-- already implemented.

CREATE OR REPLACE FUNCTION _sync_consultation_in_progress()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.doctor_connected_at IS NOT NULL
     AND NEW.patient_connected_at IS NOT NULL
     AND NEW.status = 'accepted' THEN
    NEW.status := 'in_progress';
    NEW.started_at := GREATEST(NEW.doctor_connected_at, NEW.patient_connected_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_consultation_in_progress ON public.consultations;

CREATE TRIGGER trg_sync_consultation_in_progress
  BEFORE UPDATE OF doctor_connected_at, patient_connected_at ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION _sync_consultation_in_progress();
