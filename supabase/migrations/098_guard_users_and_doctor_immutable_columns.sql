-- Phase 2 profile audit (2026-07-30), critical findings C-1/C-2 and high
-- finding H-1.
--
-- users_update_own (migration 002) has a USING clause but no WITH CHECK, and
-- Postgres reuses USING as WITH CHECK when none is given — so the only thing
-- enforced on UPDATE is that clerk_id still resolves to the same row. Any
-- authenticated user can currently PATCH their own `role` to 'admin', or
-- flip `is_suspended` back to false to lift an admin-imposed suspension.
-- Every other sensitive table (doctor_profiles, consultations, reviews)
-- already got an equivalent BEFORE UPDATE guard; users was missed.
--
-- doctor_profiles_update (migration 002) has the same missing-WITH-CHECK gap
-- on rating_average/review_count/total_consultations — a doctor can PATCH
-- their own row to inflate these directly instead of going through the
-- real trigger-driven paths (update_doctor_rating_stats in migration 055,
-- update_doctor_total_consultations in migration 094).
--
-- Two legitimate self-service flows must keep working and shaped this fix:
--   - app/(auth)/role.tsx lets a brand-new user upsert their own
--     role ('patient' or 'doctor') during onboarding — so role changes
--     between those two values must stay unrestricted, only escalation to
--     (or demotion from) 'admin' is blocked for non-admins.
--   - The account-deletion flow (mobile patient/doctor profile screens,
--     carehub-web patient/doctor profile pages) legitimately sets
--     is_suspended = true on the caller's own row as part of anonymizing a
--     deleted account — so only the true -> false (un-suspend) direction is
--     blocked for non-admins, not false -> true.

CREATE OR REPLACE FUNCTION public.guard_users_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND (NEW.role = 'admin' OR OLD.role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can grant or remove admin access.';
  END IF;

  IF OLD.is_suspended = true AND NEW.is_suspended = false THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can lift a suspension.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_users_immutable_columns ON public.users;
CREATE TRIGGER trg_00_guard_users_immutable_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_immutable_columns();

-- ── doctor_profiles: rating/review/consultation counters are system-only ───
-- update_doctor_rating_stats() (migration 055) and
-- update_doctor_total_consultations() (migration 094) are themselves BEFORE/
-- AFTER triggers on reviews/consultations that update this table internally
-- — those nested writes must still pass. pg_trigger_depth() distinguishes a
-- direct top-level client UPDATE (depth 1 inside this trigger) from one
-- cascading from another table's trigger (depth 2+), so only the former is
-- blocked.
CREATE OR REPLACE FUNCTION public.guard_doctor_profile_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.rating_average IS DISTINCT FROM OLD.rating_average
     OR NEW.review_count IS DISTINCT FROM OLD.review_count
     OR NEW.total_consultations IS DISTINCT FROM OLD.total_consultations
  THEN
    RAISE EXCEPTION 'FORBIDDEN: This field can only be updated by the system.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_doctor_profile_immutable_columns ON public.doctor_profiles;
CREATE TRIGGER trg_00_guard_doctor_profile_immutable_columns
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_doctor_profile_immutable_columns();
