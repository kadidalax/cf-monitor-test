begin;

set local search_path = public;

-- Supabase-managed default ACLs owned by supabase_admin are not mutable by
-- project-level migration roles. Runtime schema verification treats those
-- platform default ACLs as outside the application-owned schema contract while
-- still blocking public grants on actual application objects.

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v10')
on conflict (key) do update set value = excluded.value;

commit;
