-- Migration 053: doctor-specific notification_preferences columns
--
-- The doctor mobile + web notification-settings screens had UI-only toggles
-- (useState, no persistence) for categories the patient-side schema (migration
-- 003) has no columns for. Reusing consultation_request/messages/account for
-- the doctor toggles that mean the same thing; adding the doctor-unique ones
-- here so both platforms can persist through the same table/RLS policy.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS consultation_update BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS earnings             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reviews              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS announcements        BOOLEAN NOT NULL DEFAULT FALSE;
