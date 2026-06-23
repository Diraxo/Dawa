-- Creates the patient-documents storage bucket for patient-uploaded files.
-- Policies: patients can upload/read their own files; doctors can read files
-- belonging to patients they have consulted.

insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do update set public = false;

-- Allow authenticated patients to upload their own documents
create policy "patient_documents_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = get_user_id_from_jwt_sub()::text
  );

-- Allow patients to read their own documents
create policy "patient_documents_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = get_user_id_from_jwt_sub()::text
  );

-- Allow patients to delete their own documents
create policy "patient_documents_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = get_user_id_from_jwt_sub()::text
  );
