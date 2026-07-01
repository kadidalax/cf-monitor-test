begin;

set local search_path = public;

delete from records target where not exists (select 1 from clients where clients.uuid = target.client);
delete from gpu_records target where not exists (select 1 from clients where clients.uuid = target.client);
delete from gpu_snapshots target where not exists (select 1 from clients where clients.uuid = target.client);
delete from ping_records target where not exists (select 1 from clients where clients.uuid = target.client);
delete from ping_snapshots target where not exists (select 1 from clients where clients.uuid = target.client);

alter table records drop constraint if exists records_client_fkey;
alter table records
  add constraint records_client_fkey
  foreign key (client) references clients(uuid)
  deferrable initially deferred;

alter table gpu_records drop constraint if exists gpu_records_client_fkey;
alter table gpu_records
  add constraint gpu_records_client_fkey
  foreign key (client) references clients(uuid)
  deferrable initially deferred;

alter table gpu_snapshots drop constraint if exists gpu_snapshots_client_fkey;
alter table gpu_snapshots
  add constraint gpu_snapshots_client_fkey
  foreign key (client) references clients(uuid)
  deferrable initially deferred;

alter table ping_records drop constraint if exists ping_records_client_fkey;
alter table ping_records
  add constraint ping_records_client_fkey
  foreign key (client) references clients(uuid)
  deferrable initially deferred;

alter table ping_snapshots drop constraint if exists ping_snapshots_client_fkey;
alter table ping_snapshots
  add constraint ping_snapshots_client_fkey
  foreign key (client) references clients(uuid)
  deferrable initially deferred;

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v4')
on conflict (key) do update set value = excluded.value;

commit;
