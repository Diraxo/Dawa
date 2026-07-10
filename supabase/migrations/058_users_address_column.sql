-- Migration 058: add missing users.address column
--
-- Mobile (app/(patient)/edit-personal-info.tsx) and web
-- (carehub-web/app/admin/patients/page.tsx) both select/upsert
-- `users.address`, added to app code in a prior session's "final
-- pre-deployment audit" fix, but no migration ever created the column on
-- the live database. Both queries were failing outright (error silently
-- discarded by the app code) — the entire patient profile load/save on
-- mobile broke, not just the address field, since a bad column name fails
-- the whole PostgREST select/upsert.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address TEXT;
