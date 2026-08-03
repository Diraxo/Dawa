-- Doctor reviews list currently shows every review from every consultation,
-- hard-capped at 10, with no per-patient dedup and no pagination.
--
-- It also has an unrelated bug the "always show the current patient name/
-- photo" requirement is really asking us to fix: the reviewer's name is
-- fetched via `patient:users!patient_id(full_name)`, but `users` SELECT RLS
-- (users_select_own, users_select_doctor_patient — migrations 003, 070) only
-- lets a row be read by its own owner, an admin, or a doctor who has an
-- actual consultation with that patient. A patient browsing a doctor profile
-- has no such relationship to *other* reviewers, so that join silently
-- returns null for nearly every review today and the UI falls back to a
-- hardcoded "Patient" string. Fixing that requires narrowly bypassing `users`
-- RLS (SECURITY DEFINER), which is also the right place to add the
-- per-patient dedup and pagination.
--
-- get_doctor_reviews():
--   - DISTINCT ON (patient_id) collapses each patient's reviews for this
--     doctor to their single most recent one (by created_at, tiebroken by id
--     for determinism across paged fetches). Nothing is deleted/altered in
--     `reviews`, so update_doctor_rating_stats() (024, 055) keeps averaging
--     every row — the average is intentionally unaffected by this dedup.
--   - LEFT JOINs (not INNER) to users/consultations with COALESCE fallback,
--     so a review never silently vanishes from the list if the patient row
--     is ever gone — it still counts toward rating_average/review_count
--     independently, so dropping it here would desync the two.
--   - Only exposes users.full_name/profile_photo_url — no other columns.
--   - hidden = false is hardcoded here since SECURITY DEFINER bypasses the
--     reviews_select RLS policy entirely.

create or replace function public.get_doctor_reviews(
  p_doctor_id uuid,
  p_limit     int default 5,
  p_offset    int default 0
)
returns table (
  id                 uuid,
  rating             int,
  comment            text,
  created_at         timestamptz,
  consultation_type  text,
  patient_id         uuid,
  patient_name       text,
  patient_photo_url  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    d.rating,
    d.comment,
    d.created_at,
    c.type as consultation_type,
    d.patient_id,
    coalesce(u.full_name, 'Former Patient') as patient_name,
    u.profile_photo_url as patient_photo_url
  from (
    select distinct on (r.patient_id)
      r.id, r.rating, r.comment, r.created_at, r.patient_id, r.consultation_id
    from public.reviews r
    where r.doctor_id = p_doctor_id
      and r.hidden = false
    order by r.patient_id, r.created_at desc, r.id desc
  ) d
  left join public.consultations c on c.id = d.consultation_id
  left join public.users u on u.id = d.patient_id
  order by d.created_at desc, d.id desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_doctor_reviews(uuid, int, int) to anon, authenticated;
