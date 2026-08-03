-- Phase 2 profile audit (2026-07-30), medium finding M-1.
--
-- Migration 026 added size/MIME `CHECK` constraints to patient-documents and
-- doctor-documents but never to profile-photos — client-side validation
-- (ImagePicker quality/aspect settings) is the only thing stopping an
-- oversized or non-image upload today; a direct API call bypasses it
-- entirely. Both INSERT and UPDATE need the check: every mobile upload path
-- uploads to the same fixed `${clerkId}/avatar.jpg` path with
-- `upsert: true`, so the second and later uploads for a given user go
-- through the UPDATE policy, not INSERT.

DROP POLICY IF EXISTS profile_photos_insert ON storage.objects;
CREATE POLICY profile_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
    AND (metadata->>'size')::bigint <= 5242880
    AND (metadata->>'mimetype') IN ('image/jpeg', 'image/jpg', 'image/png')
  );

DROP POLICY IF EXISTS profile_photos_update ON storage.objects;
CREATE POLICY profile_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
    AND (metadata->>'size')::bigint <= 5242880
    AND (metadata->>'mimetype') IN ('image/jpeg', 'image/jpg', 'image/png')
  );
