-- Role is meant to be a one-time choice made at onboarding (app/(auth)/role.tsx):
-- once a user has picked 'patient' or 'doctor', migration 098 still let them
-- flip it to the other value via a direct UPDATE (only escalation to/from
-- 'admin' was blocked) — a patient could self-promote to 'doctor' without
-- ever going through doctor registration, since the trigger only inspected
-- the 'admin' case. The only supported way to end up with a different role
-- is to delete the account (app/(patient|doctor)/(tabs)/profile.tsx, which
-- anonymizes the row and disables its clerk_id) and sign up fresh.
--
-- role.tsx's own upsert only ever fires an UPDATE with OLD.role already NULL
-- (a brand-new row, first selection) — never on a row that already has a
-- role, since its own effects redirect away from that screen the moment one
-- exists — so this doesn't touch any legitimate client flow.
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

  IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'FORBIDDEN: Role cannot be changed once set. Delete your account and sign up again to choose a different role.';
  END IF;

  IF OLD.is_suspended = true AND NEW.is_suspended = false THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can lift a suspension.';
  END IF;

  RETURN NEW;
END;
$$;
