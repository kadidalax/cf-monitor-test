create or replace function public.cfm_rotate_user_session(input_uuid text)
returns jsonb
language sql
set search_path = public
as $$
  update users
  set session_version = session_version + 1,
      updated_at = now()
  where uuid = input_uuid
  returning to_jsonb(users);
$$;

create or replace function public.cfm_update_user_username_rotate_session(input_uuid text, input_username text)
returns jsonb
language sql
set search_path = public
as $$
  update users
  set username = input_username,
      session_version = session_version + 1,
      updated_at = now()
  where uuid = input_uuid
  returning to_jsonb(users);
$$;

revoke all on function public.cfm_rotate_user_session(text) from public;
revoke all on function public.cfm_rotate_user_session(text) from anon;
revoke all on function public.cfm_rotate_user_session(text) from authenticated;
grant execute on function public.cfm_rotate_user_session(text) to service_role;

revoke all on function public.cfm_update_user_username_rotate_session(text, text) from public;
revoke all on function public.cfm_update_user_username_rotate_session(text, text) from anon;
revoke all on function public.cfm_update_user_username_rotate_session(text, text) from authenticated;
grant execute on function public.cfm_update_user_username_rotate_session(text, text) to service_role;
