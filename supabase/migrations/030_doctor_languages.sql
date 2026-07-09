-- Add languages column to doctor_profiles
ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS languages text[] DEFAULT '{}';
