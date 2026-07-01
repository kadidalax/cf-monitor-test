begin;

set local search_path = public;

update settings
set value = '120'
where key = 'record_persist_interval_sec'
  and value = '60';

update settings
set value = '120'
where key = 'ping_record_persist_interval_sec'
  and value = '300';

update settings
set value = '120'
where key = 'live_poll_idle_interval_sec'
  and value = '600';

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v15')
on conflict (key) do update set value = excluded.value;

commit;
