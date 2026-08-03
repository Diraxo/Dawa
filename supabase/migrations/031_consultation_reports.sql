create table if not exists public.consultation_reports (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid references public.consultations(id) on delete set null,
  reporter_clerk_id text not null,
  reporter_role text not null check (reporter_role in ('patient', 'doctor')),
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.consultation_reports enable row level security;

-- Any authenticated Supabase user can insert (we validate clerk_id server-side)
create policy "authenticated insert" on public.consultation_reports
  for insert to authenticated with check (true);

-- Users can view their own reports
create policy "own reports" on public.consultation_reports
  for select using (reporter_clerk_id = (select clerk_id from public.users where id = auth.uid() limit 1));
