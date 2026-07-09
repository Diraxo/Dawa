-- Fix: doctor_profiles.rating_average/review_count never updated when a
-- patient (non-owner) inserted/updated/deleted a review, because
-- update_doctor_rating_stats() ran as the invoking role and its internal
-- UPDATE on doctor_profiles was silently blocked by the doctor_profiles
-- RLS UPDATE policy (owner-or-admin only). Making the function
-- SECURITY DEFINER lets it bypass RLS like the other trigger functions in
-- migration 024 already do.

CREATE OR REPLACE FUNCTION public.update_doctor_rating_stats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doctor_id uuid;
BEGIN
  v_doctor_id := COALESCE(NEW.doctor_id, OLD.doctor_id);
  UPDATE public.doctor_profiles
  SET
    rating_average = (
      SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
      FROM public.reviews
      WHERE doctor_id = v_doctor_id AND hidden = false
    ),
    review_count = (
      SELECT COUNT(*)::integer
      FROM public.reviews
      WHERE doctor_id = v_doctor_id AND hidden = false
    )
  WHERE id = v_doctor_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Backfill: recompute every doctor's stale rating_average/review_count now
-- that new reviews will actually apply.
UPDATE public.doctor_profiles dp
SET
  rating_average = COALESCE((
    SELECT ROUND(AVG(r.rating)::numeric, 2)
    FROM public.reviews r
    WHERE r.doctor_id = dp.id AND r.hidden = false
  ), 0),
  review_count = COALESCE((
    SELECT COUNT(*)::integer
    FROM public.reviews r
    WHERE r.doctor_id = dp.id AND r.hidden = false
  ), 0);
