set local search_path = public;

alter table website_monitors add column if not exists agent_probe_mode text not null default 'country_auto';
alter table website_monitors add column if not exists agent_probe_clients jsonb not null default '[]'::jsonb;
alter table website_monitors add column if not exists agent_probe_limit integer not null default 3;
alter table website_monitors add column if not exists agent_probe_status_enabled boolean not null default true;

update website_monitors
set agent_probe_mode = case when agent_probe_mode in ('off', 'selected', 'country_auto') then agent_probe_mode else 'country_auto' end,
    agent_probe_clients = case when jsonb_typeof(agent_probe_clients) = 'array' then agent_probe_clients else '[]'::jsonb end,
    agent_probe_limit = least(greatest(coalesce(agent_probe_limit, 3), 1), 10),
    agent_probe_status_enabled = coalesce(agent_probe_status_enabled, true);

alter table website_monitors alter column agent_probe_mode set default 'country_auto';
alter table website_monitors alter column agent_probe_clients set default '[]'::jsonb;
alter table website_monitors alter column agent_probe_limit set default 3;
alter table website_monitors alter column agent_probe_status_enabled set default true;
alter table website_monitors alter column agent_probe_mode set not null;
alter table website_monitors alter column agent_probe_clients set not null;
alter table website_monitors alter column agent_probe_limit set not null;
alter table website_monitors alter column agent_probe_status_enabled set not null;

alter table website_monitors drop constraint if exists website_monitors_agent_probe_mode_check;
alter table website_monitors add constraint website_monitors_agent_probe_mode_check check (agent_probe_mode in ('off', 'selected', 'country_auto'));
alter table website_monitors drop constraint if exists website_monitors_agent_probe_limit_check;
alter table website_monitors add constraint website_monitors_agent_probe_limit_check check (agent_probe_limit between 1 and 10);

alter table website_checks add column if not exists source_type text not null default 'worker';
alter table website_checks add column if not exists source_client text;
update website_checks set source_type = 'worker' where source_type is null or source_type not in ('worker', 'agent');
alter table website_checks alter column source_type set default 'worker';
alter table website_checks alter column source_type set not null;
alter table website_checks drop constraint if exists website_checks_source_type_check;
alter table website_checks add constraint website_checks_source_type_check check (source_type in ('worker', 'agent'));
alter table website_checks drop constraint if exists website_checks_source_client_fkey;
alter table website_checks add constraint website_checks_source_client_fkey foreign key (source_client) references clients(uuid) on delete set null;
create index if not exists idx_website_checks_monitor_source_time on website_checks(monitor_id, source_type, source_client, checked_at desc);

create or replace function public.cfm_public_websites(period_hours int default 24, check_limit int default 120)
returns jsonb
language sql
stable
set search_path = public
as $$
  with args as (
    select
      least(greatest(coalesce(period_hours, 24), 1), 72) as safe_hours,
      least(greatest(coalesce(check_limit, 120), 1), 120) as safe_limit
  ),
  monitor_rows as (
    select
      id, name, url, interval_sec, status, last_checked_at,
      last_status_code, last_raw_status_code, last_latency_ms, last_effective_reason
    from website_monitors
    where hidden = false
    order by sort_order asc, id asc
  ),
  check_rows as (
    select *
    from (
      select
        wc.monitor_id, wc.checked_at, wc.ok, wc.effective_status, wc.effective_reason,
        wc.status_code, wc.raw_status_code, wc.latency_ms, wc.source_type, wc.source_client,
        row_number() over (
          partition by wc.monitor_id,
          floor(extract(epoch from (now() - wc.checked_at)) / greatest(60, floor((a.safe_hours * 60 * 60) / a.safe_limit)))
          order by wc.checked_at desc, wc.id desc
        ) as rn
      from website_checks wc
      join website_monitors wm on wm.id = wc.monitor_id
      cross join args a
      where wm.hidden = false
        and wc.checked_at >= now() - (a.safe_hours * interval '1 hour')
        and (
          wc.source_type = 'worker'
          or wc.effective_status = 'up'
          or wm.agent_probe_status_enabled = false
        )
    ) ranked
    where rn = 1
  )
  select coalesce(jsonb_agg(
    to_jsonb(m) || jsonb_build_object(
      'checks',
      coalesce((
        select jsonb_agg(to_jsonb(c) - 'monitor_id' - 'rn' order by c.checked_at desc)
        from check_rows c
        where c.monitor_id = m.id
      ), '[]'::jsonb)
    )
  ), '[]'::jsonb)
  from monitor_rows m;
$$;

create or replace function public.cfm_public_website_monitor(input_id integer, input_check_limit integer default 120)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  return (
  with
    args as (
      select least(greatest(coalesce(input_check_limit, 120), 1), 500) as safe_limit
    ),
    monitor_row as (
      select
        id, name, url, interval_sec, status, last_checked_at,
        last_status_code, last_raw_status_code, last_latency_ms, last_effective_reason
      from website_monitors
      where id = input_id
        and hidden = false
      limit 1
    ),
    check_rows as (
      select wc.checked_at, wc.ok, wc.effective_status, wc.effective_reason,
        wc.status_code, wc.raw_status_code, wc.latency_ms, wc.source_type, wc.source_client
      from website_checks wc
      join website_monitors wm on wm.id = wc.monitor_id
      cross join args
      where wc.monitor_id = input_id
        and (
          wc.source_type = 'worker'
          or wc.effective_status = 'up'
          or wm.agent_probe_status_enabled = false
        )
      order by wc.checked_at desc, wc.id desc
      limit args.safe_limit
    )
  select to_jsonb(m) || jsonb_build_object(
    'checks',
    coalesce((select jsonb_agg(to_jsonb(c) order by c.checked_at desc) from check_rows c), '[]'::jsonb)
  )
  from monitor_row m
  );
end;
$$;

create or replace function public.cfm_record_website_check(input_check jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  monitor_row website_monitors%rowtype;
  check_ok boolean;
  checked_time timestamptz;
  source_kind text;
  source_client_id text;
begin
  if input_check is null or jsonb_typeof(input_check) <> 'object' then
    return null;
  end if;

  check_ok := coalesce((input_check->>'ok')::boolean, false);
  checked_time := coalesce((input_check->>'checked_at')::timestamptz, now());
  source_kind := coalesce(nullif(input_check->>'source_type', ''), 'worker');
  if source_kind not in ('worker', 'agent') then
    source_kind := 'worker';
  end if;
  source_client_id := nullif(input_check->>'source_client', '');

  select * into monitor_row
  from website_monitors
  where id = (input_check->>'monitor_id')::integer
  limit 1;
  if not found then
    return null;
  end if;

  insert into website_checks (
    monitor_id, checked_at, ok, effective_status, effective_reason,
    status_code, raw_status_code, latency_ms, error, source_type, source_client
  )
  values (
    (input_check->>'monitor_id')::integer,
    checked_time,
    check_ok,
    case when input_check->>'effective_status' = 'up' then 'up' else 'down' end,
    input_check->>'effective_reason',
    nullif(input_check->>'status_code', '')::integer,
    nullif(input_check->>'raw_status_code', '')::integer,
    nullif(input_check->>'latency_ms', '')::integer,
    input_check->>'error',
    source_kind,
    source_client_id
  );

  if source_kind = 'agent' and monitor_row.agent_probe_status_enabled = true and check_ok = false then
    if exists (
      select 1
      from website_checks recent_agent_success
      where recent_agent_success.monitor_id = monitor_row.id
        and recent_agent_success.source_type = 'agent'
        and recent_agent_success.effective_status = 'up'
        and recent_agent_success.checked_at >= checked_time - (greatest(monitor_row.interval_sec + 30, monitor_row.grace_period_sec, 180) * interval '1 second')
      limit 1
    ) then
      return null;
    end if;
    return to_jsonb(monitor_row);
  end if;

  if check_ok then
    update website_monitors
    set status = 'up',
        last_checked_at = checked_time,
        last_success_at = checked_time,
        last_status_code = nullif(input_check->>'status_code', '')::integer,
        last_raw_status_code = nullif(input_check->>'raw_status_code', '')::integer,
        last_latency_ms = nullif(input_check->>'latency_ms', '')::integer,
        last_effective_reason = input_check->>'effective_reason',
        last_error = null,
        down_since = null,
        updated_at = now()
    where id = (input_check->>'monitor_id')::integer
    returning * into monitor_row;
  else
    update website_monitors
    set status = 'down',
        last_checked_at = checked_time,
        last_failure_at = checked_time,
        last_status_code = nullif(input_check->>'status_code', '')::integer,
        last_raw_status_code = nullif(input_check->>'raw_status_code', '')::integer,
        last_latency_ms = nullif(input_check->>'latency_ms', '')::integer,
        last_effective_reason = input_check->>'effective_reason',
        last_error = input_check->>'error',
        down_since = coalesce(down_since, checked_time),
        last_notified_at = case when status = 'down' then last_notified_at else null end,
        updated_at = now()
    where id = (input_check->>'monitor_id')::integer
    returning * into monitor_row;
  end if;

  if not found then
    return null;
  end if;
  return to_jsonb(monitor_row);
end;
$$;

create or replace function public.cfm_create_website_monitor(input_monitor jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  created_row website_monitors%rowtype;
begin
  insert into website_monitors (
    name, url, method, expected_status_min, expected_status_max,
    interval_sec, timeout_sec, grace_period_sec, enabled, hidden,
    agent_probe_mode, agent_probe_clients, agent_probe_limit, agent_probe_status_enabled,
    sort_order
  ) values (
    coalesce(input_monitor->>'name', ''),
    coalesce(input_monitor->>'url', ''),
    coalesce(input_monitor->>'method', 'GET'),
    coalesce((input_monitor->>'expected_status_min')::integer, 200),
    coalesce((input_monitor->>'expected_status_max')::integer, 399),
    coalesce((input_monitor->>'interval_sec')::integer, 120),
    coalesce((input_monitor->>'timeout_sec')::integer, 10),
    coalesce((input_monitor->>'grace_period_sec')::integer, 180),
    coalesce((input_monitor->>'enabled')::boolean, true),
    coalesce((input_monitor->>'hidden')::boolean, false),
    case when input_monitor->>'agent_probe_mode' in ('off', 'selected', 'country_auto') then input_monitor->>'agent_probe_mode' else 'country_auto' end,
    case when input_monitor ? 'agent_probe_clients' and jsonb_typeof(input_monitor->'agent_probe_clients') = 'array' then input_monitor->'agent_probe_clients' else '[]'::jsonb end,
    least(greatest(coalesce((input_monitor->>'agent_probe_limit')::integer, 3), 1), 10),
    coalesce((input_monitor->>'agent_probe_status_enabled')::boolean, true),
    (select coalesce(max(sort_order), 0) + 1 from website_monitors)
  )
  returning * into created_row;

  return to_jsonb(created_row);
end;
$$;

create or replace function public.cfm_update_website_monitor(input_id integer, input_monitor jsonb)
returns jsonb
language sql
set search_path = public
as $$
  update website_monitors
  set
    name = coalesce(input_monitor->>'name', name),
    url = coalesce(input_monitor->>'url', url),
    method = coalesce(input_monitor->>'method', method),
    expected_status_min = coalesce((input_monitor->>'expected_status_min')::integer, expected_status_min),
    expected_status_max = coalesce((input_monitor->>'expected_status_max')::integer, expected_status_max),
    interval_sec = coalesce((input_monitor->>'interval_sec')::integer, interval_sec),
    timeout_sec = coalesce((input_monitor->>'timeout_sec')::integer, timeout_sec),
    grace_period_sec = coalesce((input_monitor->>'grace_period_sec')::integer, grace_period_sec),
    enabled = case when input_monitor ? 'enabled' then coalesce((input_monitor->>'enabled')::boolean, enabled) else enabled end,
    hidden = case when input_monitor ? 'hidden' then coalesce((input_monitor->>'hidden')::boolean, hidden) else hidden end,
    agent_probe_mode = case when input_monitor->>'agent_probe_mode' in ('off', 'selected', 'country_auto') then input_monitor->>'agent_probe_mode' else agent_probe_mode end,
    agent_probe_clients = case when input_monitor ? 'agent_probe_clients' and jsonb_typeof(input_monitor->'agent_probe_clients') = 'array' then input_monitor->'agent_probe_clients' else agent_probe_clients end,
    agent_probe_limit = case when input_monitor ? 'agent_probe_limit' then least(greatest(coalesce((input_monitor->>'agent_probe_limit')::integer, agent_probe_limit), 1), 10) else agent_probe_limit end,
    agent_probe_status_enabled = case when input_monitor ? 'agent_probe_status_enabled' then coalesce((input_monitor->>'agent_probe_status_enabled')::boolean, agent_probe_status_enabled) else agent_probe_status_enabled end,
    updated_at = now()
  where id = input_id
  returning to_jsonb(website_monitors.*);
$$;

revoke all on function public.cfm_public_websites(integer, integer) from public;
revoke all on function public.cfm_public_websites(integer, integer) from anon;
revoke all on function public.cfm_public_websites(integer, integer) from authenticated;
grant execute on function public.cfm_public_websites(integer, integer) to service_role;

revoke all on function public.cfm_public_website_monitor(integer, integer) from public;
revoke all on function public.cfm_public_website_monitor(integer, integer) from anon;
revoke all on function public.cfm_public_website_monitor(integer, integer) from authenticated;
grant execute on function public.cfm_public_website_monitor(integer, integer) to service_role;

revoke all on function public.cfm_record_website_check(jsonb) from public;
revoke all on function public.cfm_record_website_check(jsonb) from anon;
revoke all on function public.cfm_record_website_check(jsonb) from authenticated;
grant execute on function public.cfm_record_website_check(jsonb) to service_role;

revoke all on function public.cfm_create_website_monitor(jsonb) from public;
revoke all on function public.cfm_create_website_monitor(jsonb) from anon;
revoke all on function public.cfm_create_website_monitor(jsonb) from authenticated;
grant execute on function public.cfm_create_website_monitor(jsonb) to service_role;

revoke all on function public.cfm_update_website_monitor(integer, jsonb) from public;
revoke all on function public.cfm_update_website_monitor(integer, jsonb) from anon;
revoke all on function public.cfm_update_website_monitor(integer, jsonb) from authenticated;
grant execute on function public.cfm_update_website_monitor(integer, jsonb) to service_role;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-07-01-agent-website-public-results')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
