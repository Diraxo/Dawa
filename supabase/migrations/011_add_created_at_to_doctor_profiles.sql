-- doctor_profiles was missing created_at; all queries that sorted by it silently
-- returned null data, making the approvals page appear empty.
ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
