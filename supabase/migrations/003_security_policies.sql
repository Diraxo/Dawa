-- Migration: security_policies
-- Ensures RLS is enabled on every table and fills gaps left by migration 002:
--   · users         SELECT (own record + admin)
--   · doctor_profiles SELECT (own + approved status visible to patients + admin)
--   · patient_profiles doctor-read (doctor sees patient for active consultation)
--   · reviews       all policies (public read, patient insert/update with 24-h lock)
--   · storage       profile-photos public SELECT, medical-records full policy set

-- Re-declare helper in case schema was set up outside a migration file
create or replace function public.get_user_id_from_jwt_sub()
returns uuid language sql stable security definer as
$$ select id from public.users where clerk_id = (auth.jwt() ->> 'sub') limit 1 $$;

-- ── Enable RLS (idempotent) ─────────────────────────────────────────────────
alter table public.users                 enable row level security;
alter table public.patient_profiles      enable row level security;
alter table public.doctor_profiles       enable row level security;
alter table public.consultations         enable row level security;
alter table public.consultation_summaries enable row level security;
alter table public.messages              enable row level security;
alter table public.reviews               enable row level security;
alter table public.notifications         enable row level security;
alter table public.withdrawals           enable row level security;

-- ── users ───────────────────────────────────────────────────────────────────
-- SELECT: own record only (admin sees all via service-role key, not JWT)
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated
  using (
    clerk_id = (auth.jwt() ->> 'sub')
    or public.is_admin()
  );

-- ── doctor_profiles ─────────────────────────────────────────────────────────
-- SELECT:
--   · own profile (any status)
--   · approved doctors visible to all authenticated users (patient browsing)
--   · admin sees all statuses
drop policy if exists doctor_profiles_select on public.doctor_profiles;
create policy doctor_profiles_select on public.doctor_profiles
  for select to authenticated
  using (
    user_id = public.get_user_id_from_jwt_sub()
    or status = 'approved'
    or public.is_admin()
  );

-- ── patient_profiles ────────────────────────────────────────────────────────
-- Add a doctor-read policy so a doctor can see the patient's basic profile
-- during an ACTIVE consultation. The existing patient_profiles_owner policy
-- already covers patient → own record (FOR ALL).
drop policy if exists patient_profiles_doctor_read on public.patient_profiles;
create policy patient_profiles_doctor_read on public.patient_profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = patient_profiles.user_id
        and c.doctor_id  = public.get_doctor_profile_id()
        and c.status     = 'active'
    )
  );

-- ── reviews ─────────────────────────────────────────────────────────────────
-- SELECT: public (anyone can read doctor reviews on the doctor profile page)
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select
  using (true);

-- INSERT: patient only, consultation must be completed, one review per consultation
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    patient_id = public.get_user_id_from_jwt_sub()
    and exists (
      select 1 from public.consultations c
      where c.id         = reviews.consultation_id
        and c.patient_id = public.get_user_id_from_jwt_sub()
        and c.status     = 'completed'
    )
  );

-- UPDATE: patient can edit within 24 hours of creation only
drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update to authenticated
  using (
    patient_id = public.get_user_id_from_jwt_sub()
    and created_at > now() - interval '24 hours'
  );

-- ── storage: profile-photos public SELECT ───────────────────────────────────
drop policy if exists profile_photos_select on storage.objects;
create policy profile_photos_select on storage.objects
  for select
  using (bucket_id = 'profile-photos');

-- ── storage: medical-records (private — owner only) ─────────────────────────
drop policy if exists medical_records_insert on storage.objects;
create policy medical_records_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medical-records'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists medical_records_select on storage.objects;
create policy medical_records_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'medical-records'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists medical_records_update on storage.objects;
create policy medical_records_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'medical-records'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists medical_records_delete on storage.objects;
create policy medical_records_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'medical-records'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );
