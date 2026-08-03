-- Migration: doctor_patient_profile_visibility
-- Fixes the "View Profile" / chat-header patient-info bug: a doctor could
-- never read a patient's `users` row (no SELECT policy existed for that
-- direction at all), and `patient_profiles_doctor_read` only matched while
-- `consultations.status = 'active'` — but the chat screen flips status to
-- 'in_progress' the moment the doctor opens the room, so the policy stopped
-- matching almost immediately and never matched again afterward (blocking
-- patient history / post-consultation profile lookups too).
--
-- Both policies now key off "a consultation between this doctor and this
-- patient exists", with no status filter — matching how doctor_profiles is
-- already visible to patients (id-based relationship, not phase-based).

-- ── users: doctor can read a patient's basic identity ───────────────────────
drop policy if exists users_select_doctor_patient on public.users;
create policy users_select_doctor_patient on public.users
  for select to authenticated
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = users.id
        and c.doctor_id  = public.get_doctor_profile_id()
    )
  );

-- ── patient_profiles: broaden doctor-read beyond status = 'active' ─────────
drop policy if exists patient_profiles_doctor_read on public.patient_profiles;
create policy patient_profiles_doctor_read on public.patient_profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = patient_profiles.user_id
        and c.doctor_id  = public.get_doctor_profile_id()
    )
  );
