-- Migration: ensure_profile_photos_bucket
-- Creates the profile-photos storage bucket if it doesn't exist and marks it public.
-- The bucket was being referenced in storage policies since migration 002/003 but was
-- never explicitly created in a migration. The mobile app was also incorrectly uploading
-- to a non-existent 'avatars' bucket — fixed in step-4.tsx to use 'profile-photos'.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = true;
