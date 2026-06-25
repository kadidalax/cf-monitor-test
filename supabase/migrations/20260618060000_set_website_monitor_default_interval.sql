begin;

set local search_path = public;

alter table website_monitors
  alter column interval_sec set default 120;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v18')
on conflict (key) do update set value = excluded.value;

commit;
