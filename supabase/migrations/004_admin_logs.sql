-- Admin audit log table for security monitoring
create table if not exists admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references users(id) on delete set null,
  action text not null,            -- 'login', 'login_failed', 'approve_doctor', etc.
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Only service role can insert; no one reads via client
alter table admin_logs enable row level security;

create policy "service_role_only" on admin_logs
  using (false)
  with check (false);
