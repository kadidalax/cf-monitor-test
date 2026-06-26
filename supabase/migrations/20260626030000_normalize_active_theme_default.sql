begin;

set local search_path = public;

insert into settings (key, value)
values ('active_theme', 'monitor')
on conflict (key) do update
set value = case
  when settings.value in ('', 'default') then 'monitor'
  else settings.value
end;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-26-theme-active-monitor')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';

commit;
