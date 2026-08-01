-- Migration 109: Per-device push token storage (Phase-5 audit H4)
--
-- Root cause: users.push_token/fcm_token/voip_token (migration 028) are
-- scalar columns — one device per account. A second device signing in
-- silently overwrites the first device's token in each column, so only the
-- most-recently-registered device ever receives a push; logging out on one
-- device also nulls the columns other devices are still relying on, since
-- there is no per-device identity to clear selectively.
--
-- This adds a per-device table that becomes the primary fan-out source for
-- both notification edge functions (see the accompanying edge-function
-- changes). The legacy users.push_token/fcm_token/voip_token columns are
-- deliberately left in place, untouched, as a fallback for any device that
-- hasn't re-registered against this table yet (e.g. hasn't relaunched the
-- app since this shipped) — nothing about the existing single-device flow
-- is removed or broken by this migration.
--
-- Writes are only ever made through the two SECURITY DEFINER RPCs below
-- (upsert_user_device / deactivate_user_device), mirroring the existing
-- reclaim_push_token() pattern (migration 089) — identity is derived from
-- the verified JWT, never trusted from a client-supplied parameter, and a
-- token value is stripped off any other device row before being attached
-- here, closing the same cross-account/cross-device hijack class those
-- migrations were built to prevent. RLS only grants direct SELECT of a
-- caller's own rows; there is no direct INSERT/UPDATE/DELETE policy.

CREATE TABLE IF NOT EXISTS public.user_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id         text NOT NULL,
  platform          text NOT NULL CHECK (platform IN ('ios', 'android')),
  expo_push_token   text,
  fcm_token         text,
  voip_token        text,
  app_version       text,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

COMMENT ON TABLE public.user_devices IS
  'One row per physical device+app-install per account. Primary source for push fan-out (Phase-5 audit H4); users.push_token/fcm_token/voip_token remain as a fallback for devices that have not re-registered here yet. Deliberately NOT added to the supabase_realtime publication (see migration 106''s C1 finding for why broadcasting raw token columns is dangerous).';

CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
  ON public.user_devices (user_id) WHERE active = true;

-- Partial unique indexes: an active token value can only ever live on one
-- device row at a time, mirroring reclaim_push_token's cross-account
-- protection for the legacy columns.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_expo_token
  ON public.user_devices (expo_push_token) WHERE active = true AND expo_push_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_fcm_token
  ON public.user_devices (fcm_token) WHERE active = true AND fcm_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_voip_token
  ON public.user_devices (voip_token) WHERE active = true AND voip_token IS NOT NULL;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_devices_select_own ON public.user_devices;
CREATE POLICY user_devices_select_own ON public.user_devices
  FOR SELECT TO authenticated
  USING (
    user_id IN (SELECT id FROM public.users WHERE clerk_id = (auth.jwt() ->> 'sub'))
  );

-- ── upsert_user_device: register/refresh the caller's own device row ───────
-- Before attaching any of the given non-null token values to this device
-- row, strip that exact value off any *other* device row (any user) first —
-- closes the same "stale association from a previous account/session on
-- this physical device" gap reclaimTokenFromOtherUsers already closes for
-- the legacy columns.
CREATE OR REPLACE FUNCTION public.upsert_user_device(
  p_device_id       text,
  p_platform        text,
  p_expo_push_token text DEFAULT NULL,
  p_fcm_token       text DEFAULT NULL,
  p_voip_token      text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clerk_id TEXT;
  v_user_id         uuid;
BEGIN
  v_caller_clerk_id := current_setting('request.jwt.claims', true)::json->>'sub';
  IF v_caller_clerk_id IS NULL OR v_caller_clerk_id = '' THEN
    RETURN;
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE clerk_id = v_caller_clerk_id;
  IF v_user_id IS NULL OR p_device_id IS NULL OR p_device_id = '' THEN
    RETURN;
  END IF;

  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'upsert_user_device: invalid platform %', p_platform;
  END IF;

  IF p_expo_push_token IS NOT NULL AND p_expo_push_token <> '' THEN
    UPDATE public.user_devices
      SET expo_push_token = NULL
      WHERE expo_push_token = p_expo_push_token
        AND NOT (user_id = v_user_id AND device_id = p_device_id);
  END IF;
  IF p_fcm_token IS NOT NULL AND p_fcm_token <> '' THEN
    UPDATE public.user_devices
      SET fcm_token = NULL
      WHERE fcm_token = p_fcm_token
        AND NOT (user_id = v_user_id AND device_id = p_device_id);
  END IF;
  IF p_voip_token IS NOT NULL AND p_voip_token <> '' THEN
    UPDATE public.user_devices
      SET voip_token = NULL
      WHERE voip_token = p_voip_token
        AND NOT (user_id = v_user_id AND device_id = p_device_id);
  END IF;

  INSERT INTO public.user_devices
    (user_id, device_id, platform, expo_push_token, fcm_token, voip_token, app_version, active, last_seen_at, updated_at)
  VALUES
    (v_user_id, p_device_id, p_platform, p_expo_push_token, p_fcm_token, p_voip_token, p_app_version, true, now(), now())
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    platform        = EXCLUDED.platform,
    expo_push_token = COALESCE(EXCLUDED.expo_push_token, public.user_devices.expo_push_token),
    fcm_token       = COALESCE(EXCLUDED.fcm_token, public.user_devices.fcm_token),
    voip_token      = COALESCE(EXCLUDED.voip_token, public.user_devices.voip_token),
    app_version     = COALESCE(EXCLUDED.app_version, public.user_devices.app_version),
    active          = true,
    last_seen_at    = now(),
    updated_at      = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_user_device(text, text, text, text, text, text) TO authenticated;

-- ── deactivate_user_device: logout, scoped to exactly this device ──────────
-- Only the row matching (caller's own user_id, this device_id) is touched —
-- other devices signed into the same account are never affected, which is
-- the entire point of moving off the single-column model.
CREATE OR REPLACE FUNCTION public.deactivate_user_device(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clerk_id TEXT;
BEGIN
  v_caller_clerk_id := current_setting('request.jwt.claims', true)::json->>'sub';
  IF v_caller_clerk_id IS NULL OR v_caller_clerk_id = '' OR p_device_id IS NULL OR p_device_id = '' THEN
    RETURN;
  END IF;

  UPDATE public.user_devices d
  SET active = false,
      expo_push_token = NULL,
      fcm_token = NULL,
      voip_token = NULL,
      updated_at = now()
  FROM public.users u
  WHERE d.user_id = u.id
    AND u.clerk_id = v_caller_clerk_id
    AND d.device_id = p_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_user_device(text) TO authenticated;
