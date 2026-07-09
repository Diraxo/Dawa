-- Migration: doctor_status_ack_generalize
--
-- Pre-deployment audit found the "has the doctor seen this status change
-- yet" ack (migration 051, doctor_profiles.approval_ack) only ever covered
-- the approved transition, only ever got read on mobile, and mobile/web ran
-- two entirely independent notification popups with different wording for
-- the same admin action. Generalize the single ack column to cover every
-- status transition (pending->approved, approved->suspended, pending-
-- >rejected, suspended->approved/reinstate, etc.) and make it the shared
-- cross-platform gate: whichever platform the doctor opens first shows the
-- canonical popup for the CURRENT status and flips status_ack to true; the
-- other platform then sees it already true and stays silent.

ALTER TABLE public.doctor_profiles RENAME COLUMN approval_ack TO status_ack;

-- Any status transition — not just "became approved" — should reset the
-- ack so the doctor is shown a fresh notice on next app open, regardless of
-- which of the two platforms (or neither) is currently mounted to catch the
-- realtime event live.
CREATE OR REPLACE FUNCTION public.enforce_doctor_status_restrictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins may freely change status, is_online, or availability. The admin
  -- API routes (carehub-web/app/api/admin/**) write through supabaseAdmin
  -- (SUPABASE_SERVICE_ROLE_KEY, see carehub-web/lib/supabase/server.ts),
  -- which has no Clerk JWT at all, so public.is_admin() (which inspects
  -- auth.jwt()->>'sub') can't recognize it — auth.role() = 'service_role'
  -- is the correct check for that path. public.is_admin() is kept too in
  -- case any future write goes through an authenticated admin session
  -- instead of the service-role client.
  IF public.is_admin() OR auth.role() = 'service_role' THEN
    -- Any admin-driven status transition resets the "seen" flag so the
    -- doctor gets a fresh notice next time either platform mounts, no
    -- matter what the previous/next status values are.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.status_ack := false;
    END IF;
    RETURN NEW;
  END IF;

  -- Only an admin may ever change a doctor's own verification status —
  -- otherwise a doctor could self-approve/un-suspend via a direct update.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can change doctor verification status.';
  END IF;

  -- A non-approved doctor can never be marked online, regardless of what
  -- the client sends.
  IF NEW.is_online = true AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.is_online := false;
  END IF;

  -- A non-approved doctor can never change their availability/schedule.
  IF NEW.availability IS DISTINCT FROM OLD.availability AND OLD.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_NOT_APPROVED: Your account must be approved before you can edit your schedule.';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged (same function name/signature), but
-- re-create it defensively in case this migration is ever re-run standalone.
DROP TRIGGER IF EXISTS trg_enforce_doctor_status_restrictions ON public.doctor_profiles;
CREATE TRIGGER trg_enforce_doctor_status_restrictions
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_doctor_status_restrictions();
