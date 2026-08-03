-- Migration: fix_rls_clerk_and_doctor_fk
-- Target: Diraxo's Project (ulrgkqjjiclulnuotifh)
--
-- WHY THIS MIGRATION EXISTS
-- The original policies used auth.uid(), which is NULL for Clerk JWTs
-- (Clerk's `sub` claim is not a UUID), so every INSERT/UPDATE guarded by
-- auth.uid() silently failed. All policies now resolve the caller through
-- users.clerk_id via get_user_id_from_jwt_sub().
--
-- Also: all app code (mobile + web) passes doctor_profiles.id as
-- consultations.doctor_id / reviews.doctor_id, but the FKs pointed to
-- users.id. The FKs are repointed to doctor_profiles(id) to match the code.

-- 1. Helper functions ----------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer as
$$ select exists (
     select 1 from public.users
     where clerk_id = (auth.jwt() ->> 'sub') and role = 'admin'
   ) $$;

create or replace function public.get_doctor_profile_id()
returns uuid language sql stable security definer as
$$ select dp.id
   from public.doctor_profiles dp
   join public.users u on u.id = dp.user_id
   where u.clerk_id = (auth.jwt() ->> 'sub')
   limit 1 $$;

-- 2. Repoint doctor_id FKs to doctor_profiles ----------------
alter table public.consultations drop constraint if exists consultations_doctor_id_fkey;
alter table public.consultations
  add constraint consultations_doctor_id_fkey
  foreign key (doctor_id) references public.doctor_profiles(id) on delete cascade;

alter table public.reviews drop constraint if exists reviews_doctor_id_fkey;
alter table public.reviews
  add constraint reviews_doctor_id_fkey
  foreign key (doctor_id) references public.doctor_profiles(id) on delete cascade;

-- 3. New columns ---------------------------------------------
alter table public.doctor_profiles add column if not exists availability jsonb;
alter table public.consultations add column if not exists reminder_sent boolean not null default false;

-- 4. users ----------------------------------------------------
drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users
  for insert to authenticated
  with check (clerk_id = (auth.jwt() ->> 'sub'));

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (clerk_id = (auth.jwt() ->> 'sub') or public.is_admin());

-- 5. doctor_profiles ------------------------------------------
drop policy if exists doctor_profiles_insert on public.doctor_profiles;
create policy doctor_profiles_insert on public.doctor_profiles
  for insert to authenticated
  with check (user_id = public.get_user_id_from_jwt_sub());

drop policy if exists doctor_profiles_update on public.doctor_profiles;
create policy doctor_profiles_update on public.doctor_profiles
  for update to authenticated
  using (user_id = public.get_user_id_from_jwt_sub() or public.is_admin());

-- 6. consultations --------------------------------------------
drop policy if exists consultations_insert on public.consultations;
create policy consultations_insert on public.consultations
  for insert to authenticated
  with check (patient_id = public.get_user_id_from_jwt_sub());

drop policy if exists consultations_select on public.consultations;
create policy consultations_select on public.consultations
  for select to authenticated
  using (
    patient_id = public.get_user_id_from_jwt_sub()
    or doctor_id = public.get_doctor_profile_id()
    or public.is_admin()
  );

drop policy if exists consultations_update on public.consultations;
create policy consultations_update on public.consultations
  for update to authenticated
  using (
    patient_id = public.get_user_id_from_jwt_sub()
    or doctor_id = public.get_doctor_profile_id()
    or public.is_admin()
  );

-- 7. consultation_summaries ------------------------------------
drop policy if exists summaries_insert on public.consultation_summaries;
create policy summaries_insert on public.consultation_summaries
  for insert to authenticated
  with check (exists (
    select 1 from public.consultations c
    where c.id = consultation_summaries.consultation_id
      and c.doctor_id = public.get_doctor_profile_id()
  ));

drop policy if exists summaries_select on public.consultation_summaries;
create policy summaries_select on public.consultation_summaries
  for select to authenticated
  using (
    exists (
      select 1 from public.consultations c
      where c.id = consultation_summaries.consultation_id
        and (c.patient_id = public.get_user_id_from_jwt_sub()
             or c.doctor_id = public.get_doctor_profile_id())
    )
    or public.is_admin()
  );

drop policy if exists summaries_update on public.consultation_summaries;
create policy summaries_update on public.consultation_summaries
  for update to authenticated
  using (exists (
    select 1 from public.consultations c
    where c.id = consultation_summaries.consultation_id
      and c.doctor_id = public.get_doctor_profile_id()
  ));

-- 8. messages ---------------------------------------------------
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = public.get_user_id_from_jwt_sub()
    and exists (
      select 1 from public.consultations c
      where c.id = messages.consultation_id
        and (c.patient_id = public.get_user_id_from_jwt_sub()
             or c.doctor_id = public.get_doctor_profile_id())
        and c.status = 'active'
    )
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.consultations c
    where c.id = messages.consultation_id
      and (c.patient_id = public.get_user_id_from_jwt_sub()
           or c.doctor_id = public.get_doctor_profile_id())
  ));

-- 9. notifications ----------------------------------------------
drop policy if exists notifications_owner on public.notifications;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = public.get_user_id_from_jwt_sub());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = public.get_user_id_from_jwt_sub());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (user_id = public.get_user_id_from_jwt_sub() or public.is_admin());

-- 10. patient_profiles ------------------------------------------
drop policy if exists patient_profiles_owner on public.patient_profiles;
create policy patient_profiles_owner on public.patient_profiles
  for all to authenticated
  using (user_id = public.get_user_id_from_jwt_sub())
  with check (user_id = public.get_user_id_from_jwt_sub());

-- 11. withdrawals (doctor_id here references users.id) ----------
drop policy if exists withdrawals_insert on public.withdrawals;
create policy withdrawals_insert on public.withdrawals
  for insert to authenticated
  with check (
    doctor_id = public.get_user_id_from_jwt_sub()
    and exists (
      select 1 from public.doctor_profiles dp
      where dp.user_id = public.get_user_id_from_jwt_sub()
        and dp.status = 'approved'
    )
  );

drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals
  for select to authenticated
  using (doctor_id = public.get_user_id_from_jwt_sub() or public.is_admin());

drop policy if exists withdrawals_update on public.withdrawals;
create policy withdrawals_update on public.withdrawals
  for update to authenticated
  using (doctor_id = public.get_user_id_from_jwt_sub() or public.is_admin());

-- 12. storage policies (folder name = Clerk user id) -------------
drop policy if exists doctor_docs_insert on storage.objects;
create policy doctor_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'doctor-documents'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists doctor_docs_select on storage.objects;
create policy doctor_docs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'doctor-documents'
    and ((auth.jwt() ->> 'sub') = (storage.foldername(name))[1] or public.is_admin())
  );

drop policy if exists doctor_docs_update on storage.objects;
create policy doctor_docs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'doctor-documents'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists doctor_docs_delete on storage.objects;
create policy doctor_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'doctor-documents'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists profile_photos_insert on storage.objects;
create policy profile_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists profile_photos_update on storage.objects;
create policy profile_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

drop policy if exists profile_photos_delete on storage.objects;
create policy profile_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );

-- 13. Appointment reminder cron (15 min before) -------------------
create or replace function trigger_appointment_reminders()
returns void
language plpgsql
security definer
as $$
declare
  rec         record;
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'carehub_service_role_key'
  limit 1;

  if service_key is null or service_key = '' then
    raise warning '[CareHub] vault secret carehub_service_role_key not set — skipping';
    return;
  end if;

  for rec in
    select id
    from   consultations
    where  scheduled_at between now() + interval '14 minutes'
                            and now() + interval '15 minutes'
    and    status        = 'pending'
    and    reminder_sent = false
  loop
    perform net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder'),
      timeout_milliseconds := 10000
    );
  end loop;
end;
$$;

select cron.schedule(
  'carehub-appointment-reminders',
  '* * * * *',
  'select trigger_appointment_reminders();'
);
