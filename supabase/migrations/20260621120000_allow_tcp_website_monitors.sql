begin;

set local search_path = public;

alter table website_monitors drop constraint if exists website_monitors_method_check;
alter table website_monitors add constraint website_monitors_method_check check (method in ('GET', 'HEAD', 'TCP'));

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v20')
on conflict (key) do update set value = excluded.value;

commit;
