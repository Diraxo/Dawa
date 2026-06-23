-- Security event log table for monitoring suspicious activity.
-- Inserts happen via the service role key from API routes only.
-- Reads are restricted to admin users via RLS.

CREATE TABLE IF NOT EXISTS security_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event        TEXT        NOT NULL,
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  email        TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  extra        JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_logs_event      ON security_logs(event);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id    ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at DESC);

ALTER TABLE security_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can query this table through the client SDK.
-- Service role (used by API routes) bypasses RLS entirely.
CREATE POLICY "Admins can read security logs"
  ON security_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.clerk_id = auth.jwt() ->> 'sub'
        AND users.role = 'admin'
    )
  );
