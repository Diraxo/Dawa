-- Migration 102: Persist the chat "Block" feature (P3-12)
--
-- Root cause: `isBlocked` in both chat-consultation screens was local
-- component state only — never written to any table, never propagated to
-- Stream. Tapping "Block" disabled the composer for that screen instance
-- only; navigating away/back or restarting the app silently un-blocked, and
-- the other party was never actually prevented from sending messages.
--
-- This migration adds the persistence layer. Enforcement (Stream channel-scoped
-- ban of the blocked party) is done by the new block-consultation-peer edge
-- function, which also writes the row here after successfully banning.

CREATE TABLE IF NOT EXISTS blocked_users (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  consultation_id  UUID        NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  blocker_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_consultation ON blocked_users(consultation_id);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- A user can only ever see their own blocks (not who has blocked them) —
-- this table is read back purely to restore the blocker's own "Messaging is
-- disabled" UI state on remount, not to announce the block to its target.
CREATE POLICY "Users read own blocks"
  ON blocked_users
  FOR SELECT
  USING (
    blocker_user_id = (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub'))
  );

-- Direct client inserts are not the enforcement path (the edge function uses
-- the service role and also performs the Stream-side ban) — but this policy
-- keeps the table usable if a client ever needs to record its own block
-- directly, scoped to consultations the caller is actually a participant in.
CREATE POLICY "Users insert own blocks on own consultations"
  ON blocked_users
  FOR INSERT
  WITH CHECK (
    blocker_user_id = (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub'))
    AND EXISTS (
      SELECT 1 FROM consultations c
      WHERE c.id = consultation_id
        AND (c.patient_id = blocker_user_id OR c.doctor_id IN (
          SELECT id FROM doctor_profiles WHERE user_id = blocker_user_id
        ))
    )
  );
