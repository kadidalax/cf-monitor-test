set local search_path = public;

create or replace function public.cfm_create_client(input_client jsonb)
returns jsonb
language sql
set search_path = public
as $$
  insert into clients (uuid, token, token_hash, token_rotated_at, name, sort_order)
  values (
    coalesce(nullif(input_client->>'uuid', ''), gen_random_uuid()::text),
    nullif(input_client->>'token', ''),
    input_client->>'token_hash',
    now(),
    coalesce(input_client->>'name', ''),
    coalesce((input_client->>'sort_order')::integer, (select coalesce(max(sort_order), 0) + 1 from clients))
  )
  returning to_jsonb(clients);
$$;

create or replace function public.cfm_rotate_client_token(input_uuid text, input_token text, input_token_hash text)
returns jsonb
language sql
set search_path = public
as $$
  update clients
  set token = input_token,
      token_hash = input_token_hash,
      token_last_used_at = null,
      token_last_used_ip = '',
      token_rotated_at = now(),
      updated_at = now()
  where uuid = input_uuid
  returning to_jsonb(clients);
$$;

drop function if exists public.cfm_rotate_client_token(text, text);
drop function if exists public.cfm_set_client_install_token(text, text);

revoke all on function public.cfm_create_client(jsonb) from public;
revoke all on function public.cfm_create_client(jsonb) from anon;
revoke all on function public.cfm_create_client(jsonb) from authenticated;
grant execute on function public.cfm_create_client(jsonb) to service_role;

revoke all on function public.cfm_rotate_client_token(text, text, text) from public;
revoke all on function public.cfm_rotate_client_token(text, text, text) from anon;
revoke all on function public.cfm_rotate_client_token(text, text, text) from authenticated;
grant execute on function public.cfm_rotate_client_token(text, text, text) to service_role;

notify pgrst, 'reload schema';
