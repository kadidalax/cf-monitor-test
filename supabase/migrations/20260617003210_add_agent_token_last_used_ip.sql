begin;

set local search_path = public;

alter table public.clients
  add column if not exists token_last_used_ip text;

insert into public.settings ("key", value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v14')
on conflict ("key") do update set value = excluded.value;

commit;
