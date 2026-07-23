-- reviews_update policy (patient_id = self) has no WITH CHECK, and Postgres
-- reuses the USING expression as WITH CHECK when none is given — so the only
-- thing enforced on UPDATE is that patient_id stays the same. A patient can
-- currently PATCH their own review row's doctor_id/consultation_id to a
-- doctor they never consulted (the SECURITY DEFINER rating trigger from
-- migration 055 then folds that review into the new doctor's rating_average/
-- review_count — rating manipulation), or flip hidden/hidden_reason back to
-- undo an admin's moderation action. Every other sensitive table
-- (consultations, doctor_profiles) already got an equivalent BEFORE UPDATE
-- guard; reviews was missed.

CREATE OR REPLACE FUNCTION public.guard_review_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.patient_id      IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id       IS DISTINCT FROM OLD.doctor_id
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.hidden          IS DISTINCT FROM OLD.hidden
     OR NEW.hidden_reason   IS DISTINCT FROM OLD.hidden_reason
  THEN
    RAISE EXCEPTION 'FORBIDDEN: This field can only be changed by an admin.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_review_immutable_columns ON public.reviews;
CREATE TRIGGER trg_00_guard_review_immutable_columns
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_review_immutable_columns();
