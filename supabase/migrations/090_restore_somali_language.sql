-- Restore Somali to the enabled-languages list. Migration 006 seeded
-- platform_settings.languages as ["en","am","om","ti"] — Somali was never
-- included, so the onboarding language selector (app/(auth)/language.tsx),
-- which filters its full language list down to whatever this row contains,
-- silently dropped Somali for every user. Only adds 'so' if missing; leaves
-- every other admin-configured language untouched.
update platform_settings
set value = (
  case
    when value @> '["so"]'::jsonb then value
    else value || '["so"]'::jsonb
  end
)
where key = 'languages';
