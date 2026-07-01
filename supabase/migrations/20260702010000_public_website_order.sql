set local search_path = public;

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
      last_status_code, last_raw_status_code, last_latency_ms, last_effective_reason,
      sort_order
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
    (to_jsonb(m) - 'sort_order') || jsonb_build_object(
      'checks',
      coalesce((
        select jsonb_agg(to_jsonb(c) - 'monitor_id' - 'rn' order by c.checked_at desc)
        from check_rows c
        where c.monitor_id = m.id
      ), '[]'::jsonb)
    )
    order by m.sort_order asc, m.id asc
  ), '[]'::jsonb)
  from monitor_rows m;
$$;

revoke all on function public.cfm_public_websites(integer, integer) from public;
revoke all on function public.cfm_public_websites(integer, integer) from anon;
revoke all on function public.cfm_public_websites(integer, integer) from authenticated;
grant execute on function public.cfm_public_websites(integer, integer) to service_role;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-07-02-public-website-order')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
