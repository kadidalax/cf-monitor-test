begin;

set local search_path = public;

alter table public.clients force row level security;
alter table public.records force row level security;
alter table public.gpu_records force row level security;
alter table public.gpu_snapshots force row level security;
alter table public.users force row level security;
alter table public.login_rate_limits force row level security;
alter table public.settings force row level security;
alter table public.ping_tasks force row level security;
alter table public.ping_records force row level security;
alter table public.ping_snapshots force row level security;
alter table public.offline_notifications force row level security;
alter table public.expiry_notifications force row level security;
alter table public.load_notifications force row level security;
alter table public.audit_logs force row level security;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v8')
on conflict (key) do update set value = excluded.value;

commit;
