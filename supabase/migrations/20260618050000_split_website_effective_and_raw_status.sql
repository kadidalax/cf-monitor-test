begin;

set local search_path = public;

alter table website_monitors
  add column if not exists last_raw_status_code integer,
  add column if not exists last_effective_reason text;

alter table website_checks
  add column if not exists effective_status text not null default 'down',
  add column if not exists effective_reason text,
  add column if not exists raw_status_code integer;

update website_monitors
set last_raw_status_code = last_status_code
where last_raw_status_code is null
  and last_status_code is not null;

update website_monitors
set last_effective_reason = case
  when status = 'up' and last_error is null and last_status_code in (401, 403, 405, 412, 429) then 'reachable_challenge'
  when status = 'up' and last_error is null and last_status_code is not null then 'status_in_expected_range'
  when status = 'down' and last_error is not null then last_error
  else last_effective_reason
end
where last_effective_reason is null;

update website_checks
set effective_status = case when ok then 'up' else 'down' end,
    effective_reason = coalesce(effective_reason, case
      when ok and error is null and status_code in (401, 403, 405, 412, 429) then 'reachable_challenge'
      when ok and error is null then 'status_in_expected_range'
      when not ok and error is not null then error
      else 'unknown'
    end),
    raw_status_code = coalesce(raw_status_code, status_code);

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v17')
on conflict (key) do update set value = excluded.value;

commit;
