begin;

set local search_path = public;

do $$
begin
  if to_regrole('cf_monitor_app') is null then
    create role cf_monitor_app nologin;
  end if;
end $$;

do $$
begin
  begin
    alter role cf_monitor_app nologin nosuperuser nobypassrls nocreaterole;
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

grant usage on schema public to cf_monitor_app;
grant select, insert, update, delete on all tables in schema public to cf_monitor_app;
grant usage on all sequences in schema public to cf_monitor_app;
alter default privileges in schema public grant select, insert, update, delete on tables to cf_monitor_app;
alter default privileges in schema public grant usage on sequences to cf_monitor_app;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'records',
    'gpu_records',
    'gpu_snapshots',
    'users',
    'login_rate_limits',
    'settings',
    'ping_tasks',
    'ping_records',
    'ping_snapshots',
    'offline_notifications',
    'expiry_notifications',
    'load_notifications',
    'audit_logs'
  ] loop
    execute format('drop policy if exists cf_monitor_app_all on public.%I', table_name);
    execute format(
      'create policy cf_monitor_app_all on public.%I for all to cf_monitor_app using (true) with check (true)',
      table_name
    );
  end loop;
end $$;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v7')
on conflict (key) do update set value = excluded.value;

commit;
