-- Doctor Consultations tab: real per-row "unread" tracking.
--
-- Root cause of "unread badge never clears": the per-tab number shown next
-- to each tab (e.g. "Completed (42)") was never an unread count — it was
-- `consultations.filter(bucket).length`, a running total of every row in
-- that status bucket, computed purely client-side. It could never clear on
-- open because it was never tied to any "seen" state.
--
-- Audit of the existing schema found no column already tracking doctor-seen
-- state for consultations: messages.read_at and notifications.read_at exist,
-- but both belong to unrelated subsystems (Stream Chat's own unread state
-- for the Messages tab, and the web toast/alert banner) and neither is read
-- anywhere in the Consultations screens. So two new columns are added here
-- rather than duplicating an existing one:
--
--   status_changed_at — maintained by a trigger, updated only when `status`
--                        actually changes (not on heartbeat/connection
--                        timestamp writes such as last_heartbeat_at,
--                        doctor_connected_at, etc.) — marks when a row
--                        entered its current tab bucket.
--   doctor_viewed_at   — written by the client when the doctor opens the
--                        tab/screen that currently contains the row.
--
-- A row is "unread" (counts toward its bucket's badge) when
-- doctor_viewed_at is null or older than status_changed_at.

alter table public.consultations
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists doctor_viewed_at timestamptz;

-- Existing rows: treat as already seen so this migration doesn't flood every
-- doctor's badges with their entire consultation history on deploy.
update public.consultations
  set status_changed_at = coalesce(updated_at, created_at, now()),
      doctor_viewed_at = now()
  where doctor_viewed_at is null;

create or replace function public.touch_consultation_status_changed_at()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    NEW.status_changed_at := now();
  elsif NEW.status is distinct from OLD.status then
    NEW.status_changed_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_consultations_status_changed_at on public.consultations;
create trigger trg_consultations_status_changed_at
  before insert or update on public.consultations
  for each row execute function public.touch_consultation_status_changed_at();
