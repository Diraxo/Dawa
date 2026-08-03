-- Migration: user_suspension
-- Adds is_suspended boolean to users table so admins can suspend patient accounts.
-- Suspended patients cannot log in or book consultations.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookups of suspended users
CREATE INDEX IF NOT EXISTS idx_users_is_suspended ON public.users (is_suspended)
  WHERE is_suspended = TRUE;

-- RLS: allow admins to update is_suspended (existing users policies already allow admin read/write)
-- The is_admin() function check on existing users policies covers this column automatically.
