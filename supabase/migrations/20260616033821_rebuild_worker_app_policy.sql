begin;

set local search_path = public;

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
values ('schema_bootstrap_version', 'postgres-2026-06-15-v9')
on conflict (key) do update set value = excluded.value;

commit;
