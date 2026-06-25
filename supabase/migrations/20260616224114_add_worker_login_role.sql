begin;

set local search_path = public;

do $$
begin
  if to_regrole('cf_monitor_worker') is null then
    create role cf_monitor_worker
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end $$;

do $$
begin
  begin
    alter role cf_monitor_worker
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

grant cf_monitor_app to cf_monitor_worker;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v13')
on conflict (key) do update set value = excluded.value;

commit;
