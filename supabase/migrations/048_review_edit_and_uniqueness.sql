-- Rating flow fix: a patient could previously submit unlimited reviews for
-- the same consultation (no DB constraint stopped it, and the mobile UI
-- never checked for an existing review before showing the blank rating
-- form). This enforces "one rating per consultation" at the DB layer and
-- lets the patient edit that rating indefinitely instead of only within a
-- 24-hour window.

-- One review per consultation, enforced authoritatively (not just in the UI).
alter table public.reviews
  add constraint reviews_consultation_id_unique unique (consultation_id);

-- UPDATE: patient can edit their own review at any time, not just within the
-- first 24 hours — the mobile "Edit Rating"/"Edit Review" actions must keep
-- working whenever the patient revisits a completed consultation.
drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update to authenticated
  using (
    patient_id = public.get_user_id_from_jwt_sub()
  );

-- Migration 024 consolidated the doctor-rating-stats trigger but, in doing
-- so, dropped trg_review_notification (from migration 007) without
-- recreating it — on_review_created() (which notifies the doctor of a new
-- rating) still exists as a function but hasn't fired on any INSERT since.
-- Recreate it; on_review_created() is unchanged and still valid.
drop trigger if exists trg_review_notification on public.reviews;
create trigger trg_review_notification
  after insert on public.reviews
  for each row execute function on_review_created();
