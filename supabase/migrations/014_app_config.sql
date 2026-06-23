-- App version config per platform (read by mobile useVersionCheck hook)
create table if not exists public.app_config (
  id             uuid        primary key default gen_random_uuid(),
  platform       text        not null check (platform in ('android', 'ios')),
  min_required_version text  not null default '1.0.0',
  latest_version text        not null default '1.0.0',
  update_message text        not null default 'A new version of Dawa is available. Please update to continue.',
  store_url      text        not null default '',
  updated_at     timestamptz not null default now(),
  unique (platform)
);

-- Seed default rows for both platforms
insert into public.app_config (platform, min_required_version, latest_version, update_message, store_url)
values
  ('android', '1.0.0', '1.0.0',
   'A new version of Dawa is available. Please update to continue using the app.',
   'https://play.google.com/store/apps/details?id=com.carehub'),
  ('ios', '1.0.0', '1.0.0',
   'A new version of Dawa is available. Please update to continue using the app.',
   'https://apps.apple.com/app/carehub')
on conflict (platform) do nothing;

-- RLS: anyone can read (mobile reads before auth); only service role writes
alter table public.app_config enable row level security;

create policy "app_config_public_read" on public.app_config
  for select using (true);

create policy "app_config_service_write" on public.app_config
  for all to authenticated using (false) with check (false);
