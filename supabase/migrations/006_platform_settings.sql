-- Migration: platform_settings
-- Creates a key-value store for admin-configurable platform settings.
-- Enables Supabase Realtime on doctor_profiles, users, and platform_settings
-- so the admin dashboard receives live updates without polling.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read or write platform settings
DROP POLICY IF EXISTS "platform_settings_all" ON public.platform_settings;
CREATE POLICY "platform_settings_all" ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Enable realtime for admin live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings;

-- Seed default values (skip if already present)
INSERT INTO public.platform_settings (key, value) VALUES
  ('commission_rate', '20'::jsonb),
  ('countries', '["ET","RW","US","AF"]'::jsonb),
  ('languages', '["en","am","om","ti"]'::jsonb),
  ('email_approval_template', to_jsonb('Hello Dr. {name},' || chr(10) || chr(10) || 'We are pleased to inform you that your Dawa application has been approved!' || chr(10) || chr(10) || 'You can now log in and start accepting patient consultations.' || chr(10) || chr(10) || 'Welcome to the Dawa team!' || chr(10) || chr(10) || 'Best regards,' || chr(10) || 'The Dawa Team')),
  ('email_rejection_template', to_jsonb('Hello Dr. {name},' || chr(10) || chr(10) || 'Thank you for applying to Dawa. After reviewing your application, we were unable to approve it at this time.' || chr(10) || chr(10) || 'Reason: {reason}' || chr(10) || chr(10) || 'If you believe this is an error or would like to reapply with updated documents, please contact our support team.' || chr(10) || chr(10) || 'Best regards,' || chr(10) || 'The Dawa Team')),
  ('app_version', '"1.0.0"'::jsonb),
  ('version_notes', '"Initial release"'::jsonb)
ON CONFLICT (key) DO NOTHING;
