-- Migration 026: Storage bucket file size and MIME type enforcement
-- Adds CHECK constraints to storage policies to block uploads that bypass
-- client-side validation (direct API calls, curl, etc.).

-- patient-documents bucket: max 10 MB, allowed types only
-- Note: Supabase storage policies for INSERT use the storage.objects table.
-- The `metadata` JSONB column contains {"mimetype": "...", "size": N}.

DROP POLICY IF EXISTS "Patients upload their own documents" ON storage.objects;

CREATE POLICY "Patients upload their own documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_id_from_jwt_sub()::text
    -- Enforce max 10 MB at the storage layer
    AND (metadata->>'size')::bigint <= 10485760
    -- Allow only safe MIME types
    AND (metadata->>'mimetype') IN (
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf'
    )
  );

DROP POLICY IF EXISTS "Patients read their own documents" ON storage.objects;

CREATE POLICY "Patients read their own documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_id_from_jwt_sub()::text
  );

DROP POLICY IF EXISTS "Patients delete their own documents" ON storage.objects;

CREATE POLICY "Patients delete their own documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_id_from_jwt_sub()::text
  );

-- Also constrain doctor-documents bucket (used for credential uploads)
DROP POLICY IF EXISTS "Doctors upload their own documents" ON storage.objects;

CREATE POLICY "Doctors upload their own documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'doctor-documents'
    AND (storage.foldername(name))[1] = public.get_user_id_from_jwt_sub()::text
    AND (metadata->>'size')::bigint <= 10485760
    AND (metadata->>'mimetype') IN (
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf'
    )
  );
