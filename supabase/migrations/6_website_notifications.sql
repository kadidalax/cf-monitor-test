-- Notification candidates follow the current monitor state, independently of
-- whether a Worker probe is due or an Agent already supplied the latest result.
create or replace function public.cfm_pending_website_notifications(
  input_now text,
  input_limit integer default 50,
  input_after_id bigint default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(candidate) order by
    case when candidate.id > greatest(coalesce(input_after_id, 0), 0) then 0 else 1 end,
    candidate.id
  ), '[]'::jsonb)
  from (
    select wm.*
    from website_monitors wm
    where wm.enabled = true
      and (
        (wm.status = 'down' and wm.last_notified_at is null and wm.down_since is not null
          and wm.down_since <= input_now::timestamptz - wm.grace_period_sec * interval '1 second')
        or (wm.status = 'up' and wm.last_notified_at is not null)
      )
    order by
      case when wm.id > greatest(coalesce(input_after_id, 0), 0) then 0 else 1 end,
      wm.id
    limit least(greatest(coalesce(input_limit, 50), 1), 50)
  ) candidate;
$$;

revoke all on function public.cfm_pending_website_notifications(text, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.cfm_pending_website_notifications(text, integer, bigint)
  to service_role;
