-- Migration 076: web_push_subscriptions table
-- Stores browser Web Push subscriptions (one row per subscribed
-- browser/device) so patient/doctor web can receive notifications even when
-- the tab/browser is fully closed — the mobile app already has this via
-- Expo/FCM/APNs push; the web app previously had no push infra at all
-- (only a foreground `new Notification(...)` in AppointmentAlerts.tsx).

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_id ON web_push_subscriptions(user_id);

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own subscriptions. Edge functions send
-- via the service-role key, which bypasses RLS entirely.
CREATE POLICY "Users manage own web push subscriptions"
  ON web_push_subscriptions
  FOR ALL
  USING (
    user_id = (
      SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')
    )
  );
