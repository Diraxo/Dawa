-- Migration: specialties
-- Admin-managed list of doctor specialties shown in registration and patient search.

CREATE TABLE IF NOT EXISTS public.specialties (
  id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name text        UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;

-- Anyone (authenticated or anonymous) can read specialties
DROP POLICY IF EXISTS "specialties_read" ON public.specialties;
CREATE POLICY "specialties_read" ON public.specialties
  FOR SELECT USING (true);

-- Only admins can insert / update / delete
DROP POLICY IF EXISTS "specialties_admin_write" ON public.specialties;
CREATE POLICY "specialties_admin_write" ON public.specialties
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Enable real-time so changes propagate instantly everywhere
ALTER PUBLICATION supabase_realtime ADD TABLE public.specialties;

-- Seed: start with a single general specialty; admin can add more from the dashboard
INSERT INTO public.specialties (name) VALUES
  ('General Practice')
ON CONFLICT (name) DO NOTHING;
