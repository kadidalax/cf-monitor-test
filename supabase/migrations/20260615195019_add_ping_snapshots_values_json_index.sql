begin;

set local search_path = public;

create index if not exists idx_ping_snapshots_values_json
on public.ping_snapshots using gin (values_json);

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v6')
on conflict (key) do update set value = excluded.value;

commit;
