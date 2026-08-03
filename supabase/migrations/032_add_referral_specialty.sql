-- The web EndConsultationModal has always written a `referral_specialty`
-- field into consultation_summaries, but the column never existed. Because
-- the insert error was never checked, every web-originated consultation end
-- silently failed to save a summary row while the consultation was still
-- marked completed -- surfacing to patients as "doctor hasn't submitted
-- consultation notes yet".
alter table public.consultation_summaries
  add column if not exists referral_specialty text;
