-- Migration 003: notification_preferences table
-- Stores per-user notification toggle preferences.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consultation_request BOOLEAN     NOT NULL DEFAULT TRUE,
  messages             BOOLEAN     NOT NULL DEFAULT TRUE,
  appointment_reminder BOOLEAN     NOT NULL DEFAULT TRUE,
  consultation_summary BOOLEAN     NOT NULL DEFAULT TRUE,
  promotions           BOOLEAN     NOT NULL DEFAULT FALSE,
  health_tips          BOOLEAN     NOT NULL DEFAULT FALSE,
  account              BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own preferences.
CREATE POLICY "Users manage own notification preferences"
  ON notification_preferences
  FOR ALL
  USING (
    user_id = (
      SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')
    )
  );

-- Trigger to keep updated_at current on every change.
CREATE OR REPLACE FUNCTION touch_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_notification_preferences_updated_at();
