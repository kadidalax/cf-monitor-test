set local search_path = public;

update settings
set value = '120'
where key = 'live_poll_active_max_duration_sec'
  and value = '600';

insert into settings (key, value)
values ('live_poll_active_max_duration_sec', '120')
on conflict (key) do nothing;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-07-03-v1')
on conflict (key) do update set value = excluded.value;
