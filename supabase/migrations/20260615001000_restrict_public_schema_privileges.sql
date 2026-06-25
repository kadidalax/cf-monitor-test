begin;

set local search_path = public;

do $$
declare
  role_name text;
begin
  revoke all on schema public from public;
  revoke all on all tables in schema public from public;
  revoke all on all sequences in schema public from public;
  revoke all on all functions in schema public from public;
  alter default privileges in schema public revoke all on tables from public;
  alter default privileges in schema public revoke all on sequences from public;
  alter default privileges in schema public revoke all on functions from public;

  foreach role_name in array array['anon', 'authenticated'] loop
    if to_regrole(role_name) is not null then
      execute format('revoke all on schema public from %I', role_name);
      execute format('revoke all on all tables in schema public from %I', role_name);
      execute format('revoke all on all sequences in schema public from %I', role_name);
      execute format('revoke all on all functions in schema public from %I', role_name);
      execute format('alter default privileges in schema public revoke all on tables from %I', role_name);
      execute format('alter default privileges in schema public revoke all on sequences from %I', role_name);
      execute format('alter default privileges in schema public revoke all on functions from %I', role_name);
    end if;
  end loop;
end $$;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v3')
on conflict (key) do update set value = excluded.value;

commit;
