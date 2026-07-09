-- Migration 025: Extended audit_logs table
-- Adds a comprehensive audit_logs table alongside the existing admin_logs.
-- The existing admin_logs table is preserved for backward compatibility.
-- New code should write to audit_logs; the logAdminAction helper writes to both.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp     timestamptz NOT NULL    DEFAULT now(),

  -- Actor (who performed the action)
  actor_clerk_id  text,
  actor_id        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role      text,       -- 'admin' | 'doctor' | 'patient' | 'system'

  -- What happened
  action        text        NOT NULL,

  -- What was affected
  entity_type   text,       -- 'consultation' | 'doctor_profile' | 'patient' | 'payment' | etc.
  entity_id     text,

  -- Change tracking
  old_value     jsonb,
  new_value     jsonb,

  -- Context
  ip_address    text,
  user_agent    text,
  metadata      jsonb       -- arbitrary extra context

  -- Note: created_at alias for timestamp is omitted to avoid confusion;
  -- always use the `timestamp` column for ordering.
);

-- RLS: only service role writes; only admins read via client
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_admin_read" ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.clerk_id = (auth.jwt() ->> 'sub')
        AND users.role = 'admin'
    )
  );

-- Indexes for common filter patterns used in the admin audit UI
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp      ON public.audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id       ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action         ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity         ON public.audit_logs (entity_type, entity_id);

-- Rate-limits table (if not already created by the rate-limit edge function)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  identifier        text        NOT NULL,
  attempt_type      text        NOT NULL,
  count             integer     NOT NULL DEFAULT 1,
  first_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  PRIMARY KEY (identifier, attempt_type)
);

-- RLS: only service role accesses rate_limits
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limits_service_only" ON public.rate_limits
  USING (false)
  WITH CHECK (false);

-- TTL cleanup: auto-delete rate_limit rows older than 2 hours (keeps table small)
CREATE OR REPLACE FUNCTION public.cleanup_stale_rate_limits()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.rate_limits
  WHERE last_attempt_at < now() - INTERVAL '2 hours'
    AND (locked_until IS NULL OR locked_until < now());
END;
$$;
