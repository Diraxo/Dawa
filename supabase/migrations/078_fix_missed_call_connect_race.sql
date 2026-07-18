-- Migration 078: fix a race in mark_missed_calls() that could stamp an
-- already-connecting call as 'missed'.
--
-- mark_missed_calls() (migration 018) only checked
-- status='accepted' AND started_at < NOW() - INTERVAL '5 minutes'. On an
-- 'accepted' row, started_at is set at ACCEPT time (app/(doctor)/incoming-
-- request.tsx), not at connect time — the "both connected" transition to
-- in_progress (migration 035's trigger) only happens once BOTH
-- doctor_connected_at and patient_connected_at are non-null, so a row can
-- legitimately still be 'accepted' 5+ minutes after accept while one side
-- has already connected and is waiting on the other (a slow push, a slow
-- app resume, a slow Agora join). The sweep had no way to distinguish that
-- from a genuine no-answer, so it could mark a live, actively-connecting
-- call 'missed' out from under it. Once status leaves 'accepted', the
-- trigger can never perform the in_progress transition, and the slower
-- side's own connect write (gated on .eq('status','accepted')) silently
-- no-ops — stranding the call as 'missed' on one side while the other may
-- have already seen it succeed moments earlier.
--
-- Fix: only sweep rows where NEITHER side has connected yet — a genuine
-- unanswered call, never one where a connection is already under way.

CREATE OR REPLACE FUNCTION mark_missed_calls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE consultations
  SET
    status = 'missed',
    updated_at = NOW()
  WHERE
    status = 'accepted'
    AND type IN ('phone', 'video')
    AND started_at IS NOT NULL
    AND started_at < NOW() - INTERVAL '5 minutes'
    AND doctor_connected_at IS NULL
    AND patient_connected_at IS NULL;
END;
$$;
