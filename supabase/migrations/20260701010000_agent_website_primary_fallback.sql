set local search_path = public;

alter table website_monitors alter column agent_probe_mode set default 'country_auto';
alter table website_monitors alter column agent_probe_status_enabled set default true;

update website_monitors
set agent_probe_mode = 'country_auto',
    agent_probe_status_enabled = true,
    updated_at = now()
where enabled = true
  and agent_probe_mode = 'off'
  and agent_probe_status_enabled = false;

create or replace function public.cfm_due_website_monitors(input_now text, input_limit integer default 50)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  return (
  select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  from (
    select wm.*
    from website_monitors wm
    where wm.enabled = true
      and (
        wm.last_checked_at is null
        or wm.last_checked_at <= input_now::timestamptz - (greatest(wm.interval_sec - 30, 1) * interval '1 second')
      )
      and (
        wm.agent_probe_mode = 'off'
        or (
          wm.agent_probe_status_enabled = true
          and not exists (
            select 1
            from website_checks recent_agent_success
            where recent_agent_success.monitor_id = wm.id
              and recent_agent_success.source_type = 'agent'
              and recent_agent_success.effective_status = 'up'
              and recent_agent_success.checked_at >= input_now::timestamptz - (greatest(wm.interval_sec + 30, wm.grace_period_sec, 180) * interval '1 second')
          )
        )
      )
    order by coalesce(wm.last_checked_at, '1970-01-01'::timestamptz) asc, wm.sort_order asc, wm.id asc
    limit least(greatest(coalesce(input_limit, 50), 1), 200)
  ) row_data
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
  checked_time := (input_check->>'checked_at')::timestamptz;
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

revoke all on function public.cfm_due_website_monitors(text, integer) from public;
revoke all on function public.cfm_due_website_monitors(text, integer) from anon;
revoke all on function public.cfm_due_website_monitors(text, integer) from authenticated;
grant execute on function public.cfm_due_website_monitors(text, integer) to service_role;

revoke all on function public.cfm_record_website_check(jsonb) from public;
revoke all on function public.cfm_record_website_check(jsonb) from anon;
revoke all on function public.cfm_record_website_check(jsonb) from authenticated;
grant execute on function public.cfm_record_website_check(jsonb) to service_role;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-07-01-agent-website-primary-fallback')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
