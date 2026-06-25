create schema if not exists cfm_internal;

create table if not exists cfm_internal.demo_reset (
  key text primary key default 'default' check (key = 'default'),
  snapshot jsonb,
  last_restored_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.cfm_demo_reset_state()
returns jsonb
language sql
security definer
set search_path = public, cfm_internal
as $$
  select jsonb_build_object(
    'snapshot_exists', snapshot is not null,
    'last_restored_at', last_restored_at
  )
  from cfm_internal.demo_reset
  where key = 'default';
$$;

create or replace function public.cfm_demo_snapshot()
returns jsonb
language sql
security definer
set search_path = public, cfm_internal
as $$
  select snapshot
  from cfm_internal.demo_reset
  where key = 'default';
$$;

create or replace function public.cfm_save_demo_snapshot(input_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = public, cfm_internal
as $$
begin
  if input_snapshot is null or jsonb_typeof(input_snapshot) <> 'object' then
    raise exception 'snapshot must be a JSON object';
  end if;

  insert into cfm_internal.demo_reset (key, snapshot, updated_at)
  values ('default', input_snapshot, now())
  on conflict (key) do update set
    snapshot = excluded.snapshot,
    updated_at = now();
end;
$$;

create or replace function public.cfm_mark_demo_reset_restored(input_restored_at text)
returns void
language sql
security definer
set search_path = public, cfm_internal
as $$
  insert into cfm_internal.demo_reset (key, last_restored_at, updated_at)
  values ('default', input_restored_at::timestamptz, now())
  on conflict (key) do update set
    last_restored_at = excluded.last_restored_at,
    updated_at = now();
$$;

create or replace function public.cfm_reset_admin_users(input_uuid text, input_username text, input_passwd text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(input_uuid), '') is null
    or nullif(trim(input_username), '') is null
    or nullif(trim(input_passwd), '') is null then
    raise exception 'admin uuid, username, and password hash are required';
  end if;

  delete from login_rate_limits;
  delete from users;

  insert into users (uuid, username, passwd, session_version, password_changed_at)
  values (input_uuid, input_username, input_passwd, 1, now());
end;
$$;

create or replace function public.cfm_restore_demo_snapshot(input_backup jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  monitor_ids bigint[];
begin
  perform public.cfm_restore_backup_data(input_backup);

  if input_backup ? 'website_monitors' and jsonb_typeof(input_backup->'website_monitors') = 'array' then
    select coalesce(array_agg(id), array[]::bigint[]) into monitor_ids
    from (
      select (value->>'id')::bigint as id
      from jsonb_array_elements(input_backup->'website_monitors')
      where coalesce(value->>'id', '') ~ '^[0-9]+$'
        and (value->>'id')::bigint > 0
    ) rows;

    if coalesce(array_length(monitor_ids, 1), 0) > 0 then
      delete from website_checks where not (monitor_id = any(monitor_ids));
      delete from website_monitors where not (id = any(monitor_ids));
    else
      delete from website_monitors;
    end if;

    for item in select value from jsonb_array_elements(input_backup->'website_monitors')
    loop
      if not (coalesce(item->>'id', '') ~ '^[0-9]+$') or (item->>'id')::bigint <= 0 then
        continue;
      end if;

      insert into website_monitors (
        id, name, url, method, expected_status_min, expected_status_max,
        interval_sec, timeout_sec, grace_period_sec, enabled, hidden, sort_order,
        status, last_checked_at, last_success_at, last_failure_at, last_status_code,
        last_raw_status_code, last_latency_ms, last_effective_reason, last_error,
        down_since, last_notified_at, created_at, updated_at
      )
      values (
        (item->>'id')::bigint,
        coalesce(item->>'name', ''),
        coalesce(item->>'url', ''),
        coalesce(item->>'method', 'GET'),
        coalesce((item->>'expected_status_min')::integer, 200),
        coalesce((item->>'expected_status_max')::integer, 399),
        coalesce((item->>'interval_sec')::integer, 120),
        coalesce((item->>'timeout_sec')::integer, 10),
        coalesce((item->>'grace_period_sec')::integer, 180),
        coalesce((item->>'enabled')::boolean, true),
        coalesce((item->>'hidden')::boolean, false),
        coalesce((item->>'sort_order')::integer, 0),
        coalesce(item->>'status', 'pending'),
        nullif(item->>'last_checked_at', '')::timestamptz,
        nullif(item->>'last_success_at', '')::timestamptz,
        nullif(item->>'last_failure_at', '')::timestamptz,
        nullif(item->>'last_status_code', '')::integer,
        nullif(item->>'last_raw_status_code', '')::integer,
        nullif(item->>'last_latency_ms', '')::integer,
        nullif(item->>'last_effective_reason', ''),
        nullif(item->>'last_error', ''),
        nullif(item->>'down_since', '')::timestamptz,
        nullif(item->>'last_notified_at', '')::timestamptz,
        coalesce(nullif(item->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(item->>'updated_at', '')::timestamptz, now())
      )
      on conflict (id) do update set
        name = excluded.name,
        url = excluded.url,
        method = excluded.method,
        expected_status_min = excluded.expected_status_min,
        expected_status_max = excluded.expected_status_max,
        interval_sec = excluded.interval_sec,
        timeout_sec = excluded.timeout_sec,
        grace_period_sec = excluded.grace_period_sec,
        enabled = excluded.enabled,
        hidden = excluded.hidden,
        sort_order = excluded.sort_order,
        status = excluded.status,
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        last_status_code = excluded.last_status_code,
        last_raw_status_code = excluded.last_raw_status_code,
        last_latency_ms = excluded.last_latency_ms,
        last_effective_reason = excluded.last_effective_reason,
        last_error = excluded.last_error,
        down_since = excluded.down_since,
        last_notified_at = excluded.last_notified_at,
        updated_at = excluded.updated_at;
    end loop;

    perform setval(pg_get_serial_sequence('website_monitors', 'id'), coalesce((select max(id) from website_monitors), 0) + 1, false);
  end if;
end;
$$;

revoke all on function public.cfm_demo_reset_state() from public;
revoke all on function public.cfm_demo_reset_state() from anon;
revoke all on function public.cfm_demo_reset_state() from authenticated;
grant execute on function public.cfm_demo_reset_state() to service_role;

revoke all on function public.cfm_demo_snapshot() from public;
revoke all on function public.cfm_demo_snapshot() from anon;
revoke all on function public.cfm_demo_snapshot() from authenticated;
grant execute on function public.cfm_demo_snapshot() to service_role;

revoke all on function public.cfm_save_demo_snapshot(jsonb) from public;
revoke all on function public.cfm_save_demo_snapshot(jsonb) from anon;
revoke all on function public.cfm_save_demo_snapshot(jsonb) from authenticated;
grant execute on function public.cfm_save_demo_snapshot(jsonb) to service_role;

revoke all on function public.cfm_mark_demo_reset_restored(text) from public;
revoke all on function public.cfm_mark_demo_reset_restored(text) from anon;
revoke all on function public.cfm_mark_demo_reset_restored(text) from authenticated;
grant execute on function public.cfm_mark_demo_reset_restored(text) to service_role;

revoke all on function public.cfm_reset_admin_users(text, text, text) from public;
revoke all on function public.cfm_reset_admin_users(text, text, text) from anon;
revoke all on function public.cfm_reset_admin_users(text, text, text) from authenticated;
grant execute on function public.cfm_reset_admin_users(text, text, text) to service_role;

revoke all on function public.cfm_restore_demo_snapshot(jsonb) from public;
revoke all on function public.cfm_restore_demo_snapshot(jsonb) from anon;
revoke all on function public.cfm_restore_demo_snapshot(jsonb) from authenticated;
grant execute on function public.cfm_restore_demo_snapshot(jsonb) to service_role;

notify pgrst, 'reload schema';
