-- Migration: fix_patient_read_doctor_users_row
--
-- Problem (Issue 2 — "patient tapping a doctor spins forever"): every patient-
-- facing doctor query joins `users!inner(...)` to get the doctor's name/photo
-- (app/(patient)/doctor-profile.tsx, (tabs)/doctors.tsx, (tabs)/home.tsx). An
-- inner join is subject to RLS on BOTH tables — doctor_profiles already has a
-- 'status = approved is visible to all authenticated users' policy
-- (003_security_policies.sql), but `users` only ever had users_select_own
-- (self) and users_select_doctor_patient (a doctor reading a patient they
-- have a consultation with, 070_doctor_patient_profile_visibility.sql). No
-- policy has ever let a *patient* read a *doctor's* users row, so the inner
-- join silently returns zero rows for every doctor, every time. The screens
-- have no error handling for this (data is just null), so they spin forever
-- instead of failing loudly — this migration fixes the actual data-access gap
-- so the symptom stops occurring at all.
--
-- This mirrors the existing doctor_profiles_select policy's own condition
-- (status = 'approved' is public) rather than introducing a new visibility
-- rule — a patient could already see everything on the doctor_profiles row
-- that references this user, so exposing this user's name/photo for the same
-- approved doctor adds no new disclosure.

drop policy if exists users_select_approved_doctor on public.users;
create policy users_select_approved_doctor on public.users
  for select to authenticated
  using (
    exists (
      select 1 from public.doctor_profiles dp
      where dp.user_id = users.id
        and dp.status = 'approved'
    )
  );
