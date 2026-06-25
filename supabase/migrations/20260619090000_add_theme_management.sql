begin;

set local search_path = public;

create table if not exists themes (
  short text primary key,
  name text not null,
  description text not null default '',
  version text not null default '',
  author text not null default '',
  url text not null default '',
  preview_path text not null default '',
  style_path text not null,
  manifest_json text not null,
  config_json text not null default '{}',
  custom_css text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint themes_short_check check (short ~ '^[A-Za-z0-9_-]+$' and short <> 'default')
);

create table if not exists theme_assets (
  theme_short text not null,
  path text not null,
  content_type text not null,
  content_base64 text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint theme_assets_theme_short_fkey foreign key (theme_short) references themes(short) on delete cascade,
  primary key (theme_short, path)
);

insert into settings (key, value)
values ('active_theme', 'default')
on conflict (key) do nothing;

alter table public.themes enable row level security;
alter table public.theme_assets enable row level security;
alter table public.themes force row level security;
alter table public.theme_assets force row level security;

grant select, insert, update, delete on public.themes to cf_monitor_app;
grant select, insert, update, delete on public.theme_assets to cf_monitor_app;

drop policy if exists cf_monitor_app_all on public.themes;
create policy cf_monitor_app_all on public.themes for all to cf_monitor_app using (true) with check (true);
drop policy if exists cf_monitor_app_all on public.theme_assets;
create policy cf_monitor_app_all on public.theme_assets for all to cf_monitor_app using (true) with check (true);

insert into settings (key, value)
values ('schema_bootstrap_version', 'postgres-2026-06-15-v19')
on conflict (key) do update set value = excluded.value;

commit;
