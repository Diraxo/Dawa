-- Creates the consultation-reports storage bucket for the branded PDF
-- consultation report (web-generated via @react-pdf/renderer, mobile-generated
-- via expo-print). One file per consultation at "{consultation_id}/report.pdf".
-- Readable/writable by the consultation's patient and assigned doctor (+ admin),
-- reusing the same clerk-aware helper functions from migration 002.

insert into storage.buckets (id, name, public)
values ('consultation-reports', 'consultation-reports', false)
on conflict (id) do update set public = false;

create policy "consultation_reports_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'consultation-reports'
    and (
      exists (
        select 1 from public.consultations c
        where c.id::text = (storage.foldername(name))[1]
          and (c.patient_id = public.get_user_id_from_jwt_sub()
               or c.doctor_id = public.get_doctor_profile_id())
      )
      or public.is_admin()
    )
  );

create policy "consultation_reports_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'consultation-reports'
    and exists (
      select 1 from public.consultations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.patient_id = public.get_user_id_from_jwt_sub()
             or c.doctor_id = public.get_doctor_profile_id())
    )
  );

create policy "consultation_reports_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'consultation-reports'
    and exists (
      select 1 from public.consultations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.patient_id = public.get_user_id_from_jwt_sub()
             or c.doctor_id = public.get_doctor_profile_id())
    )
  );
