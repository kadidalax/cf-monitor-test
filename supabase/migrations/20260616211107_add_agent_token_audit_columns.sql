begin;

set local search_path = public;

alter table public.clients
  add column if not exists token_last_used_at timestamptz,
  add column if not exists token_rotated_at timestamptz;

update public.clients
set token_rotated_at = coalesce(updated_at, created_at, now())
where token_rotated_at is null
  and coalesce(token_hash, token, '') <> '';

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v12')
on conflict (key) do update set value = excluded.value;

commit;
