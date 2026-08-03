-- Migration: document_update_workflow
--
-- Doctor mobile audit, Issue 8 follow-up: "Update Documents" currently just
-- opens a mailto link to support — there is no in-app re-upload path and no
-- admin gate for it. This adds:
--   - doctor_profiles.documents_update_allowed: admin-only toggle. When
--     false (default), the doctor sees no re-upload UI at all.
--   - doctor_profiles.document_review_status: tracks a re-upload separately
--     from the original onboarding `status`, so a doctor re-uploading a
--     license doesn't get bounced back into the onboarding
--     pending/under-review flow or lose their already-approved account
--     status while the new documents are reviewed.
--
-- Both columns are guarded the same way migration 056 guards `status`: a
-- doctor can never grant themselves the update-allowed toggle or
-- self-approve a re-upload — only admin (or the service-role admin API)
-- can do that. A doctor may only ever move document_review_status to
-- 'pending' (by re-uploading), and only while the admin has switched the
-- toggle on.

ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS documents_update_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document_review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS document_reviewed_at timestamptz;

ALTER TABLE public.doctor_profiles
  DROP CONSTRAINT IF EXISTS doctor_profiles_document_review_status_check;
ALTER TABLE public.doctor_profiles
  ADD CONSTRAINT doctor_profiles_document_review_status_check
  CHECK (document_review_status IN ('pending', 'approved', 'rejected'));

CREATE OR REPLACE FUNCTION public.enforce_document_update_restrictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only an admin may flip the re-upload toggle itself.
  IF NEW.documents_update_allowed IS DISTINCT FROM OLD.documents_update_allowed THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin can enable document updates.';
  END IF;

  IF NEW.document_review_status IS DISTINCT FROM OLD.document_review_status THEN
    -- A doctor may only submit a re-upload for review, never self-approve
    -- or self-reject, and only once an admin has enabled updates.
    IF NEW.document_review_status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'FORBIDDEN: Only an admin can approve or reject documents.';
    END IF;
    IF OLD.documents_update_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'FORBIDDEN: Document updates are not currently enabled for your account.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_document_update_restrictions ON public.doctor_profiles;
CREATE TRIGGER trg_enforce_document_update_restrictions
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_update_restrictions();
