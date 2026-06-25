begin;

set local search_path = public;

alter table public.clients
  add column if not exists token_hash text;

update public.clients
set token_hash = 'sha256:' || encode(sha256(convert_to(token, 'UTF8')), 'hex')
where coalesce(token_hash, '') = ''
  and coalesce(token, '') <> '';

alter table public.clients
  alter column token drop not null;

update public.clients
set token = null
where coalesce(token_hash, '') <> ''
  and coalesce(token, '') <> '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_token_hash_key'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_token_hash_key unique (token_hash);
  end if;
end $$;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v11')
on conflict (key) do update set value = excluded.value;

commit;
