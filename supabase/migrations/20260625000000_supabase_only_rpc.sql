begin;

set local search_path = public;

create or replace function public.cfm_create_user(input_uuid text, input_username text, input_passwd text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(coalesce(input_uuid, '')), '') is null
    or nullif(trim(coalesce(input_username, '')), '') is null
    or coalesce(input_passwd, '') = ''
  then
    raise exception 'user uuid, username, and password hash are required';
  end if;

  insert into users (uuid, username, passwd, password_changed_at)
  values (input_uuid, input_username, input_passwd, now());
  return true;
end;
$$;

create or replace function public.cfm_delete_user_if_matches(input_uuid text, input_username text, input_passwd text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from users
  where uuid = input_uuid
    and username = input_username
    and passwd = input_passwd;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.cfm_login_rate_limit(input_bucket text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(row_data)
  from (
    select bucket, failures, first_failed_at, last_failed_at, locked_until
    from login_rate_limits
    where bucket = input_bucket
    limit 1
  ) row_data;
$$;

create or replace function public.cfm_login_rate_limits(input_buckets jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with buckets as (
    select distinct value as bucket
    from jsonb_array_elements_text(case when jsonb_typeof(input_buckets) = 'array' then input_buckets else '[]'::jsonb end)
    where trim(value) <> ''
  )
  select coalesce(jsonb_agg(to_jsonb(l) order by l.bucket), '[]'::jsonb)
  from login_rate_limits l
  join buckets b on b.bucket = l.bucket;
$$;

create or replace function public.cfm_set_login_rate_limit(input_state jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  if input_state is null or jsonb_typeof(input_state) <> 'object' or nullif(input_state->>'bucket', '') is null then
    raise exception 'login rate limit state must include bucket';
  end if;

  insert into login_rate_limits (bucket, failures, first_failed_at, last_failed_at, locked_until)
  values (
    input_state->>'bucket',
    coalesce((input_state->>'failures')::integer, 0),
    coalesce((input_state->>'first_failed_at')::timestamptz, now()),
    coalesce((input_state->>'last_failed_at')::timestamptz, now()),
    nullif(input_state->>'locked_until', '')::timestamptz
  )
  on conflict (bucket) do update set
    failures = excluded.failures,
    first_failed_at = excluded.first_failed_at,
    last_failed_at = excluded.last_failed_at,
    locked_until = excluded.locked_until;
end;
$$;

create or replace function public.cfm_set_login_rate_limits(input_states jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
begin
  if input_states is null or jsonb_typeof(input_states) <> 'array' then
    return;
  end if;

  for item in select value from jsonb_array_elements(input_states)
  loop
    perform public.cfm_set_login_rate_limit(item);
  end loop;
end;
$$;

create or replace function public.cfm_clear_login_rate_limits(input_buckets jsonb)
returns void
language sql
set search_path = public
as $$
  delete from login_rate_limits
  where bucket in (
    select value
    from jsonb_array_elements_text(case when jsonb_typeof(input_buckets) = 'array' then input_buckets else '[]'::jsonb end)
    where trim(value) <> ''
  );
$$;

create or replace function public.cfm_delete_login_rate_limits_before(input_before_time text)
returns void
language sql
set search_path = public
as $$
  delete from login_rate_limits
  where last_failed_at < input_before_time::timestamptz
    and (locked_until is null or locked_until < now());
$$;

create or replace function public.cfm_clear_all_records()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  deleted_records integer := 0;
  deleted_gpu_records integer := 0;
  deleted_gpu_snapshots integer := 0;
  deleted_ping_records integer := 0;
  deleted_ping_snapshots integer := 0;
begin
  with deleted as (delete from records returning 1)
  select count(*)::integer into deleted_records from deleted;

  with deleted as (delete from gpu_records returning 1)
  select count(*)::integer into deleted_gpu_records from deleted;

  with deleted as (delete from gpu_snapshots returning 1)
  select count(*)::integer into deleted_gpu_snapshots from deleted;

  with deleted as (delete from ping_records returning 1)
  select count(*)::integer into deleted_ping_records from deleted;

  with deleted as (delete from ping_snapshots returning 1)
  select count(*)::integer into deleted_ping_snapshots from deleted;

  return jsonb_build_object(
    'deleted', jsonb_build_object(
      'records', deleted_records,
      'gpu_records', deleted_gpu_records,
      'gpu_snapshots', deleted_gpu_snapshots,
      'ping_records', deleted_ping_records,
      'ping_snapshots', deleted_ping_snapshots
    ),
    'remaining', jsonb_build_object(
      'records', 0,
      'gpu_records', 0,
      'gpu_snapshots', 0,
      'ping_records', 0,
      'ping_snapshots', 0
    ),
    'has_more', false
  );
end;
$$;

create or replace function public.cfm_clear_client_records(input_client text)
returns void
language sql
set search_path = public
as $$
  delete from records where client = input_client;
  delete from gpu_records where client = input_client;
  delete from gpu_snapshots where client = input_client;
  delete from ping_records where client = input_client;
  delete from ping_snapshots where client = input_client;
$$;

create or replace function public.cfm_restore_backup_data(input_backup jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  client_ids text[];
  task_ids bigint[];
begin
  if input_backup is null or jsonb_typeof(input_backup) <> 'object' then
    raise exception 'backup must be a JSON object';
  end if;

  if input_backup ? 'settings' and jsonb_typeof(input_backup->'settings') = 'object' then
    insert into settings (key, value)
    select key, value
    from jsonb_each_text(input_backup->'settings')
    where trim(key) <> ''
    on conflict (key) do update set value = excluded.value;
  end if;

  if input_backup ? 'clients' and jsonb_typeof(input_backup->'clients') = 'array' then
    select coalesce(array_agg(uuid), array[]::text[]) into client_ids
    from (
      select nullif(trim(value->>'uuid'), '') as uuid
      from jsonb_array_elements(input_backup->'clients')
    ) rows
    where uuid is not null;

    delete from records where not (client = any(client_ids));
    delete from gpu_records where not (client = any(client_ids));
    delete from gpu_snapshots where not (client = any(client_ids));
    delete from ping_records where not (client = any(client_ids));
    delete from ping_snapshots where not (client = any(client_ids));
    delete from offline_notifications where not (client = any(client_ids));
    delete from expiry_notifications where not (client = any(client_ids));
    delete from clients where not (uuid = any(client_ids));

    for item in select value from jsonb_array_elements(input_backup->'clients')
    loop
      if nullif(trim(item->>'uuid'), '') is null then
        continue;
      end if;

      insert into clients (
        uuid, token, token_hash, token_last_used_at, token_last_used_ip, token_rotated_at,
        name, cpu_name, virtualization, arch, cpu_cores, os, kernel_version, gpu_name,
        ipv4, ipv6, region, remark, public_remark, mem_total, swap_total, disk_total,
        version, price, billing_cycle, auto_renewal, currency, expired_at, "group", tags,
        hidden, traffic_limit, traffic_limit_type, sort_order, created_at, updated_at
      )
      values (
        item->>'uuid',
        nullif(item->>'token', ''),
        nullif(item->>'token_hash', ''),
        nullif(item->>'token_last_used_at', '')::timestamptz,
        coalesce(item->>'token_last_used_ip', ''),
        nullif(item->>'token_rotated_at', '')::timestamptz,
        coalesce(item->>'name', ''),
        coalesce(item->>'cpu_name', ''),
        coalesce(item->>'virtualization', ''),
        coalesce(item->>'arch', ''),
        coalesce((item->>'cpu_cores')::integer, 0),
        coalesce(item->>'os', ''),
        coalesce(item->>'kernel_version', ''),
        coalesce(item->>'gpu_name', ''),
        coalesce(item->>'ipv4', ''),
        coalesce(item->>'ipv6', ''),
        coalesce(item->>'region', ''),
        coalesce(item->>'remark', ''),
        coalesce(item->>'public_remark', ''),
        coalesce((item->>'mem_total')::bigint, 0),
        coalesce((item->>'swap_total')::bigint, 0),
        coalesce((item->>'disk_total')::bigint, 0),
        coalesce(item->>'version', ''),
        coalesce((item->>'price')::double precision, 0),
        coalesce((item->>'billing_cycle')::smallint, 0),
        case when coalesce((item->>'auto_renewal')::boolean, false) then 1 else 0 end,
        coalesce(item->>'currency', '$'),
        nullif(item->>'expired_at', '')::timestamptz,
        coalesce(item->>'group', ''),
        coalesce(item->>'tags', ''),
        case when coalesce((item->>'hidden')::boolean, false) then 1 else 0 end,
        coalesce((item->>'traffic_limit')::bigint, 0),
        coalesce(item->>'traffic_limit_type', 'max'),
        coalesce((item->>'sort_order')::integer, 0),
        coalesce(nullif(item->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(item->>'updated_at', '')::timestamptz, now())
      )
      on conflict (uuid) do update set
        token = excluded.token,
        token_hash = excluded.token_hash,
        token_last_used_at = excluded.token_last_used_at,
        token_last_used_ip = excluded.token_last_used_ip,
        token_rotated_at = excluded.token_rotated_at,
        name = excluded.name,
        cpu_name = excluded.cpu_name,
        virtualization = excluded.virtualization,
        arch = excluded.arch,
        cpu_cores = excluded.cpu_cores,
        os = excluded.os,
        kernel_version = excluded.kernel_version,
        gpu_name = excluded.gpu_name,
        ipv4 = excluded.ipv4,
        ipv6 = excluded.ipv6,
        region = excluded.region,
        remark = excluded.remark,
        public_remark = excluded.public_remark,
        mem_total = excluded.mem_total,
        swap_total = excluded.swap_total,
        disk_total = excluded.disk_total,
        version = excluded.version,
        price = excluded.price,
        billing_cycle = excluded.billing_cycle,
        auto_renewal = excluded.auto_renewal,
        currency = excluded.currency,
        expired_at = excluded.expired_at,
        "group" = excluded."group",
        tags = excluded.tags,
        hidden = excluded.hidden,
        traffic_limit = excluded.traffic_limit,
        traffic_limit_type = excluded.traffic_limit_type,
        sort_order = excluded.sort_order,
        updated_at = now();
    end loop;
  end if;

  if input_backup ? 'ping_tasks' and jsonb_typeof(input_backup->'ping_tasks') = 'array' then
    select coalesce(array_agg(id), array[]::bigint[]) into task_ids
    from (
      select (value->>'id')::bigint as id
      from jsonb_array_elements(input_backup->'ping_tasks')
      where coalesce(value->>'id', '') ~ '^[0-9]+$'
        and (value->>'id')::bigint > 0
    ) rows;

    if coalesce(array_length(task_ids, 1), 0) > 0 then
      delete from ping_tasks where not (id = any(task_ids));
    else
      delete from ping_tasks;
    end if;

    for item in select value from jsonb_array_elements(input_backup->'ping_tasks')
    loop
      if coalesce(item->>'id', '') ~ '^[0-9]+$' and (item->>'id')::bigint > 0 then
        insert into ping_tasks (id, name, clients, all_clients, type, target, interval_sec, sort_order)
        values (
          (item->>'id')::bigint,
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          case when coalesce((item->>'all_clients')::boolean, false) then 1 else 0 end,
          coalesce(item->>'type', 'icmp'),
          coalesce(item->>'target', ''),
          coalesce((item->>'interval_sec')::integer, 120),
          coalesce((item->>'sort_order')::integer, (item->>'id')::integer)
        )
        on conflict (id) do update set
          name = excluded.name,
          clients = excluded.clients,
          all_clients = excluded.all_clients,
          type = excluded.type,
          target = excluded.target,
          interval_sec = excluded.interval_sec,
          sort_order = excluded.sort_order;
      else
        insert into ping_tasks (name, clients, all_clients, type, target, interval_sec, sort_order)
        values (
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          case when coalesce((item->>'all_clients')::boolean, false) then 1 else 0 end,
          coalesce(item->>'type', 'icmp'),
          coalesce(item->>'target', ''),
          coalesce((item->>'interval_sec')::integer, 120),
          coalesce((item->>'sort_order')::integer, 0)
        );
      end if;
    end loop;

    perform setval(pg_get_serial_sequence('ping_tasks', 'id'), coalesce((select max(id) from ping_tasks), 0) + 1, false);
  end if;

  if input_backup ? 'offline_notifications' and jsonb_typeof(input_backup->'offline_notifications') = 'array' then
    delete from offline_notifications;
    insert into offline_notifications (client, enable, grace_period, last_notified)
    select
      value->>'client',
      case when coalesce((value->>'enable')::boolean, false) then 1 else 0 end,
      coalesce((value->>'grace_period')::integer, 180),
      nullif(value->>'last_notified', '')::timestamptz
    from jsonb_array_elements(input_backup->'offline_notifications')
    where nullif(value->>'client', '') is not null;
  end if;

  if input_backup ? 'expiry_notifications' and jsonb_typeof(input_backup->'expiry_notifications') = 'array' then
    delete from expiry_notifications;
    insert into expiry_notifications (client, enable, advance_days, last_notified)
    select
      value->>'client',
      case when coalesce((value->>'enable')::boolean, false) then 1 else 0 end,
      coalesce((value->>'advance_days')::integer, 7),
      nullif(value->>'last_notified', '')::timestamptz
    from jsonb_array_elements(input_backup->'expiry_notifications')
    where nullif(value->>'client', '') is not null;
  end if;

  if input_backup ? 'load_notifications' and jsonb_typeof(input_backup->'load_notifications') = 'array' then
    delete from load_notifications;
    for item in select value from jsonb_array_elements(input_backup->'load_notifications')
    loop
      if coalesce(item->>'id', '') ~ '^[0-9]+$' and (item->>'id')::bigint > 0 then
        insert into load_notifications (id, name, clients, metric, threshold, ratio, interval_min, last_notified)
        values (
          (item->>'id')::bigint,
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          coalesce(item->>'metric', 'cpu'),
          coalesce((item->>'threshold')::double precision, 80),
          coalesce((item->>'ratio')::double precision, 0.8),
          coalesce((item->>'interval_min')::integer, 15),
          nullif(item->>'last_notified', '')::timestamptz
        );
      else
        insert into load_notifications (name, clients, metric, threshold, ratio, interval_min, last_notified)
        values (
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          coalesce(item->>'metric', 'cpu'),
          coalesce((item->>'threshold')::double precision, 80),
          coalesce((item->>'ratio')::double precision, 0.8),
          coalesce((item->>'interval_min')::integer, 15),
          nullif(item->>'last_notified', '')::timestamptz
        );
      end if;
    end loop;

    perform setval(pg_get_serial_sequence('load_notifications', 'id'), coalesce((select max(id) from load_notifications), 0) + 1, false);
  end if;
end;
$$;

create or replace function public.cfm_insert_audit_log(
  input_user text,
  input_action text,
  input_detail text,
  input_level text default 'info'
)
returns void
language sql
set search_path = public
as $$
  insert into audit_logs ("user", action, detail, level)
  values (
    coalesce(input_user, ''),
    coalesce(input_action, ''),
    coalesce(input_detail, ''),
    coalesce(nullif(input_level, ''), 'info')
  );
$$;

revoke all on function public.cfm_create_user(text, text, text) from public;
revoke all on function public.cfm_create_user(text, text, text) from anon;
revoke all on function public.cfm_create_user(text, text, text) from authenticated;
grant execute on function public.cfm_create_user(text, text, text) to service_role;

revoke all on function public.cfm_delete_user_if_matches(text, text, text) from public;
revoke all on function public.cfm_delete_user_if_matches(text, text, text) from anon;
revoke all on function public.cfm_delete_user_if_matches(text, text, text) from authenticated;
grant execute on function public.cfm_delete_user_if_matches(text, text, text) to service_role;

revoke all on function public.cfm_login_rate_limit(text) from public;
revoke all on function public.cfm_login_rate_limit(text) from anon;
revoke all on function public.cfm_login_rate_limit(text) from authenticated;
grant execute on function public.cfm_login_rate_limit(text) to service_role;

revoke all on function public.cfm_login_rate_limits(jsonb) from public;
revoke all on function public.cfm_login_rate_limits(jsonb) from anon;
revoke all on function public.cfm_login_rate_limits(jsonb) from authenticated;
grant execute on function public.cfm_login_rate_limits(jsonb) to service_role;

revoke all on function public.cfm_set_login_rate_limit(jsonb) from public;
revoke all on function public.cfm_set_login_rate_limit(jsonb) from anon;
revoke all on function public.cfm_set_login_rate_limit(jsonb) from authenticated;
grant execute on function public.cfm_set_login_rate_limit(jsonb) to service_role;

revoke all on function public.cfm_set_login_rate_limits(jsonb) from public;
revoke all on function public.cfm_set_login_rate_limits(jsonb) from anon;
revoke all on function public.cfm_set_login_rate_limits(jsonb) from authenticated;
grant execute on function public.cfm_set_login_rate_limits(jsonb) to service_role;

revoke all on function public.cfm_clear_login_rate_limits(jsonb) from public;
revoke all on function public.cfm_clear_login_rate_limits(jsonb) from anon;
revoke all on function public.cfm_clear_login_rate_limits(jsonb) from authenticated;
grant execute on function public.cfm_clear_login_rate_limits(jsonb) to service_role;

revoke all on function public.cfm_delete_login_rate_limits_before(text) from public;
revoke all on function public.cfm_delete_login_rate_limits_before(text) from anon;
revoke all on function public.cfm_delete_login_rate_limits_before(text) from authenticated;
grant execute on function public.cfm_delete_login_rate_limits_before(text) to service_role;

revoke all on function public.cfm_clear_all_records() from public;
revoke all on function public.cfm_clear_all_records() from anon;
revoke all on function public.cfm_clear_all_records() from authenticated;
grant execute on function public.cfm_clear_all_records() to service_role;

revoke all on function public.cfm_clear_client_records(text) from public;
revoke all on function public.cfm_clear_client_records(text) from anon;
revoke all on function public.cfm_clear_client_records(text) from authenticated;
grant execute on function public.cfm_clear_client_records(text) to service_role;

revoke all on function public.cfm_restore_backup_data(jsonb) from public;
revoke all on function public.cfm_restore_backup_data(jsonb) from anon;
revoke all on function public.cfm_restore_backup_data(jsonb) from authenticated;
grant execute on function public.cfm_restore_backup_data(jsonb) to service_role;

revoke all on function public.cfm_insert_audit_log(text, text, text, text) from public;
revoke all on function public.cfm_insert_audit_log(text, text, text, text) from anon;
revoke all on function public.cfm_insert_audit_log(text, text, text, text) from authenticated;
grant execute on function public.cfm_insert_audit_log(text, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
