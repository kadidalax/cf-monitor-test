-- An explicitly unavailable measurement is distinct from a measured zero.
-- Defaults remain zero for older Agents that omit these fields entirely.
alter table public.records
  alter column cpu drop not null,
  alter column ram drop not null,
  alter column ram_total drop not null,
  alter column swap drop not null,
  alter column swap_total drop not null,
  alter column net_in drop not null,
  alter column net_out drop not null,
  alter column net_total_up drop not null,
  alter column net_total_down drop not null;

create or replace function public.cfm_insert_monitor_record(input_record jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if input_record is null or jsonb_typeof(input_record) <> 'object' then
    return;
  end if;

  insert into public.records (
    client, time, cpu, gpu, ram, ram_total, swap, swap_total, load, temp,
    disk, disk_total, net_in, net_out, net_total_up, net_total_down,
    process_count, connections, connections_udp, uptime
  ) values (
    input_record->>'client',
    (input_record->>'time')::timestamptz,
    case when input_record ? 'cpu' then (input_record->>'cpu')::double precision else 0 end,
    coalesce((input_record->>'gpu')::double precision, 0),
    case when input_record ? 'ram' then (input_record->>'ram')::double precision else 0 end,
    case when input_record ? 'ram_total' then (input_record->>'ram_total')::double precision else 0 end,
    case when input_record ? 'swap' then (input_record->>'swap')::double precision else 0 end,
    case when input_record ? 'swap_total' then (input_record->>'swap_total')::double precision else 0 end,
    case when input_record ? 'load' then (input_record->>'load')::double precision else 0 end,
    (input_record->>'temp')::double precision,
    coalesce((input_record->>'disk')::double precision, 0),
    coalesce((input_record->>'disk_total')::double precision, 0),
    case when input_record ? 'net_in' then (input_record->>'net_in')::double precision else 0 end,
    case when input_record ? 'net_out' then (input_record->>'net_out')::double precision else 0 end,
    case when input_record ? 'net_total_up' then (input_record->>'net_total_up')::double precision else 0 end,
    case when input_record ? 'net_total_down' then (input_record->>'net_total_down')::double precision else 0 end,
    coalesce((input_record->>'process_count')::integer, 0),
    coalesce((input_record->>'connections')::integer, 0),
    coalesce((input_record->>'connections_udp')::integer, 0),
    coalesce((input_record->>'uptime')::double precision, 0)
  );
end;
$$;

create or replace function public.cfm_load_metric_window_stats(
  input_clients jsonb,
  input_start text,
  input_end text,
  input_metric text,
  input_threshold double precision
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ids as (
    select distinct trim(value) as client
    from jsonb_array_elements_text(coalesce(input_clients, '[]'::jsonb)) as item(value)
    where trim(value) <> ''
  ),
  samples as (
    select
      records.client,
      case
        when input_metric = 'ram' then case when ram_total > 0 then (ram::double precision / ram_total) * 100 end
        when input_metric = 'load' then load
        when input_metric = 'disk' then case when disk_total > 0 then (disk::double precision / disk_total) * 100 end
        when input_metric = 'temp' then temp
        else cpu
      end as metric_value
    from public.records
    join ids on ids.client = records.client
    where records.time >= input_start::timestamptz
      and records.time <= input_end::timestamptz
  )
  select coalesce(jsonb_agg(to_jsonb(row_data) order by client), '[]'::jsonb)
  from (
    select
      client,
      count(*)::integer as samples,
      count(*) filter (where metric_value >= input_threshold)::integer as exceeded,
      avg(metric_value)::double precision as avg_value
    from samples
    where metric_value is not null
    group by client
  ) row_data;
$$;

revoke all on function public.cfm_insert_monitor_record(jsonb) from public, anon, authenticated;
grant execute on function public.cfm_insert_monitor_record(jsonb) to service_role;
revoke all on function public.cfm_load_metric_window_stats(jsonb, text, text, text, double precision) from public, anon, authenticated;
grant execute on function public.cfm_load_metric_window_stats(jsonb, text, text, text, double precision) to service_role;

notify pgrst, 'reload schema';
