-- Phase-5 notification audit C1: public.users is in the supabase_realtime
-- publication with no column restriction, and its SELECT RLS is broad by
-- design (users_select_approved_doctor, users_select_doctor_patient — any
-- patient can read any approved doctor's row, any doctor can read any past
-- patient's row). That means a plain postgres_changes subscription on
-- `users` broadcasts push_token/fcm_token/voip_token to anyone who can see
-- the row, bypassing the token-hijack protections built in migrations
-- 086-089 (those only guard the write path). Two production hooks
-- (usePatientAppointments.ts, usePatientDoctors.ts) subscribe to `users`
-- UPDATE events with no row filter to pick up doctor name/photo changes,
-- so `users` can't simply be dropped from the publication.
--
-- Fix: re-add `users` to the publication with an explicit column list that
-- excludes the three token columns. Requires Postgres 15+ (this project is
-- on 17.6). SET TABLE would replace the *entire* publication membership, so
-- this uses DROP + ADD to touch only this one table.

ALTER PUBLICATION supabase_realtime DROP TABLE public.users;

ALTER PUBLICATION supabase_realtime ADD TABLE public.users (
  id,
  clerk_id,
  email,
  full_name,
  phone,
  profile_photo_url,
  role,
  country,
  language,
  created_at,
  updated_at,
  is_suspended,
  address
);
