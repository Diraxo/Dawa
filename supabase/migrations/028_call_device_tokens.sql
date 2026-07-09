-- Migration: call_device_tokens
-- Adds per-device push tokens needed for system-level incoming call UI.
--
--  fcm_token  — Android FCM device token (raw, not Expo push token).
--               Sent as a high-priority FCM data message that wakes
--               the device and triggers ConnectionService even when the app is killed.
--
--  voip_token — iOS PushKit VoIP token (not the regular APNs token).
--               Delivered via APNs VoIP push which wakes the device,
--               then CallKit shows the native incoming-call screen.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS fcm_token  TEXT,
  ADD COLUMN IF NOT EXISTS voip_token TEXT;

-- Index for quick lookup when the notification function runs
CREATE INDEX IF NOT EXISTS idx_users_fcm_token  ON public.users (fcm_token)  WHERE fcm_token  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_voip_token ON public.users (voip_token) WHERE voip_token IS NOT NULL;

-- Allow the authenticated user to update only their own token columns
-- (RLS policy assumes an existing policy pattern; we just add the new columns)
-- No new policy needed — the existing UPDATE policy on users already covers this.
