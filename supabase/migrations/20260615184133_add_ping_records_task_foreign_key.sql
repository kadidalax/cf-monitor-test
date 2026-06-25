begin;

set local search_path = public;

delete from ping_records target
where not exists (
  select 1
  from ping_tasks
  where ping_tasks.id = target.task_id
);

alter table ping_records drop constraint if exists ping_records_task_fkey;
alter table ping_records
  add constraint ping_records_task_fkey
  foreign key (task_id) references ping_tasks(id)
  on delete cascade
  deferrable initially deferred;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v5')
on conflict (key) do update set value = excluded.value;

commit;
