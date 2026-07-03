set local search_path = public;

create or replace function public.cfm_recover_single_admin(input_uuid text, input_username text, input_passwd text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  user_count integer;
  target_uuid text;
  recovered users%rowtype;
begin
  if nullif(trim(coalesce(input_uuid, '')), '') is null
    or nullif(trim(coalesce(input_username, '')), '') is null
    or coalesce(input_passwd, '') = ''
  then
    raise exception 'user uuid, username, and password hash are required';
  end if;

  select count(*)::integer into user_count from users;

  if user_count = 0 then
    insert into users (uuid, username, passwd, password_changed_at)
    values (input_uuid, input_username, input_passwd, now())
    returning * into recovered;
  elsif user_count = 1 then
    select uuid into target_uuid from users limit 1;
    update users
    set username = input_username,
        passwd = input_passwd,
        session_version = session_version + 1,
        password_changed_at = now(),
        updated_at = now()
    where uuid = target_uuid
    returning * into recovered;
  else
    raise exception 'admin recovery supports exactly one admin user';
  end if;

  return to_jsonb(recovered);
end;
$$;

revoke all on function public.cfm_recover_single_admin(text, text, text) from public;
revoke all on function public.cfm_recover_single_admin(text, text, text) from anon;
revoke all on function public.cfm_recover_single_admin(text, text, text) from authenticated;
grant execute on function public.cfm_recover_single_admin(text, text, text) to service_role;

notify pgrst, 'reload schema';
