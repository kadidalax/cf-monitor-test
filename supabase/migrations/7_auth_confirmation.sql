-- Atomic MFA acknowledgements and conditional credential upgrades.
-- Store only operation/factor digests, identity and timestamps, never factors
-- or session tokens. Replaying this migration preserves pending receipts.
create table if not exists cfm_internal.mfa_factor_receipts (
  user_uuid text not null references public.users(uuid) on delete cascade,
  operation_id text not null check (operation_id ~ '^[a-f0-9]{64}$'),
  factor_key text not null check (factor_key ~ '^[a-f0-9]{64}$'),
  session_version integer not null,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (user_uuid, operation_id)
);
alter table cfm_internal.mfa_factor_receipts enable row level security;
alter table cfm_internal.mfa_factor_receipts force row level security;
revoke all on cfm_internal.mfa_factor_receipts from public, anon, authenticated;
grant select, insert, update, delete on cfm_internal.mfa_factor_receipts to service_role;

create or replace function public.cfm_consume_mfa_factor(
  input_uuid text,
  input_session_version integer,
  input_operation_id text,
  input_factor_key text,
  input_method text,
  input_step bigint default null,
  input_code_hashes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account public.users%rowtype;
  receipt cfm_internal.mfa_factor_receipts%rowtype;
  matched_hash text;
  confirmed_at timestamptz := now();
begin
  if coalesce(input_operation_id, '') !~ '^[a-f0-9]{64}$'
    or coalesce(input_factor_key, '') !~ '^[a-f0-9]{64}$'
    or coalesce(input_method, '') not in ('totp', 'recovery_code')
    or input_session_version is null or input_session_version < 1
  then return jsonb_build_object('verified', false); end if;

  if input_method = 'recovery_code' then
    if jsonb_typeof(input_code_hashes) is distinct from 'array' then
      return jsonb_build_object('verified', false);
    end if;
    if jsonb_array_length(input_code_hashes) not between 1 and 4 or exists (
      select 1 from jsonb_array_elements(input_code_hashes) item
      where jsonb_typeof(item) <> 'string' or (item #>> '{}') !~ '^(v2\.[a-f0-9]{16}\.)?[A-Za-z0-9_-]{43}$'
    ) then return jsonb_build_object('verified', false); end if;
  end if;

  -- All factor consumption for an account shares the user row lock. No external
  -- I/O occurs while this short transaction owns the lock.
  select * into account from public.users where uuid = input_uuid for update;
  if not found or account.session_version <> input_session_version
    or account.totp_enabled_at is null or account.totp_secret_enc is null
  then return jsonb_build_object('verified', false); end if;

  delete from cfm_internal.mfa_factor_receipts
    where user_uuid = input_uuid and expires_at <= confirmed_at;
  select * into receipt from cfm_internal.mfa_factor_receipts
    where user_uuid = input_uuid and operation_id = input_operation_id;
  if found then
    if receipt.session_version = input_session_version and receipt.factor_key = input_factor_key then
      return jsonb_build_object('verified', true, 'verified_at', receipt.verified_at);
    end if;
    return jsonb_build_object('verified', false);
  end if;

  if input_method = 'totp' then
    -- An expired code can recover an existing acknowledgement above, but only
    -- a currently verified step can create a new acknowledgement.
    if input_step is null or input_step < 0 or account.totp_last_used_step >= input_step then
      return jsonb_build_object('verified', false);
    end if;
    update public.users set totp_last_used_step = input_step, updated_at = confirmed_at where uuid = input_uuid;
  else
    select candidate.value into matched_hash
      from jsonb_array_elements_text(input_code_hashes) with ordinality candidate(value, position)
      where account.recovery_code_hashes ? candidate.value order by candidate.position limit 1;
    if matched_hash is null then return jsonb_build_object('verified', false); end if;
    update public.users set recovery_code_hashes = recovery_code_hashes - matched_hash,
      updated_at = confirmed_at where uuid = input_uuid;
  end if;

  insert into cfm_internal.mfa_factor_receipts(user_uuid, operation_id, factor_key, session_version, verified_at, expires_at)
  values (input_uuid, input_operation_id, input_factor_key, input_session_version, confirmed_at, confirmed_at + interval '5 minutes');
  insert into public.audit_logs("user", action, detail, level)
  values (account.username, 'mfa_factor_confirmed', jsonb_build_object('method', input_method)::text, 'info');
  return jsonb_build_object('verified', true, 'verified_at', confirmed_at);
end;
$$;
revoke all on function public.cfm_consume_mfa_factor(text, integer, text, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cfm_consume_mfa_factor(text, integer, text, text, text, bigint, jsonb) to service_role;

-- Record the business transition in the same transaction. Ordinary factor
-- consumption and conditional re-encryption do not rotate session_version.
create or replace function cfm_internal.audit_mfa_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_action text;
  event_detail text;
begin
  if new.session_version is not distinct from old.session_version then return new; end if;
  if new.totp_enabled_at is not null and
    (old.totp_enabled_at is null or new.totp_secret_enc is distinct from old.totp_secret_enc) then
    event_action := 'mfa_enabled'; event_detail := 'TOTP enabled';
  elsif new.totp_enabled_at is null and old.totp_enabled_at is not null then
    event_action := 'mfa_disabled'; event_detail := 'TOTP disabled';
  elsif new.totp_enabled_at is not null and new.recovery_code_hashes is distinct from old.recovery_code_hashes then
    event_action := 'mfa_recovery_codes_regenerated'; event_detail := 'Recovery codes regenerated';
  else return new;
  end if;
  insert into public.audit_logs("user", action, detail, level)
  values (new.username, event_action, event_detail, 'info');
  return new;
end;
$$;
revoke all on function cfm_internal.audit_mfa_change() from public, anon, authenticated;
grant execute on function cfm_internal.audit_mfa_change() to service_role;
drop trigger if exists cfm_audit_mfa_change on public.users;
create trigger cfm_audit_mfa_change after update on public.users
for each row execute function cfm_internal.audit_mfa_change();

create or replace function public.cfm_rehash_user_password(input_uuid text, input_expected_passwd text, input_passwd text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(input_passwd, '') = '' or length(input_passwd) > 4096 then return false; end if;
  update public.users set passwd = input_passwd, updated_at = now()
    where uuid = input_uuid and passwd = input_expected_passwd;
  return found;
end;
$$;
revoke all on function public.cfm_rehash_user_password(text, text, text) from public, anon, authenticated;
grant execute on function public.cfm_rehash_user_password(text, text, text) to service_role;

create or replace function public.cfm_reencrypt_totp_secret(input_uuid text, input_expected_secret text, input_secret_enc text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(input_secret_enc, '') !~ '^v2\.[a-f0-9]{16}\.' or length(input_secret_enc) > 4096 then return false; end if;
  update public.users set totp_secret_enc = input_secret_enc, updated_at = now()
    where uuid = input_uuid and totp_secret_enc = input_expected_secret and totp_enabled_at is not null;
  return found;
end;
$$;
revoke all on function public.cfm_reencrypt_totp_secret(text, text, text) from public, anon, authenticated;
grant execute on function public.cfm_reencrypt_totp_secret(text, text, text) to service_role;

notify pgrst, 'reload schema';
