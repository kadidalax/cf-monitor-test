import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260622000000_rpc_api.sql', 'utf8');
const liveData = readFileSync('worker/src/do/live-data.ts', 'utf8');

const checks = [
  [
    migration.includes('alter table website_checks add column if not exists source_type') &&
      migration.includes('alter table website_checks add column if not exists source_client') &&
      migration.includes('alter table website_monitors add column if not exists agent_probe_status_enabled'),
    'latest migration must backfill agent website columns before referencing them',
  ],
  [
    migration.includes("wc.source_type = 'worker'") &&
      migration.includes("wc.effective_status = 'up'") &&
      migration.includes('wm.agent_probe_status_enabled = false'),
    'public website RPC must show worker checks, agent successes, and non-fallback agent failures',
  ],
  [
    migration.includes('recent_agent_success') &&
      migration.includes("source_kind = 'agent'") &&
      migration.includes('check_ok = false') &&
      migration.includes('return null;'),
    'agent failure fallback must ignore failures when another recent agent success exists',
  ],
  [
    migration.includes('create or replace function public.cfm_create_website_monitor') &&
      migration.includes('create or replace function public.cfm_update_website_monitor') &&
      migration.includes('agent_probe_mode') &&
      migration.includes('agent_probe_clients') &&
      migration.includes('agent_probe_limit') &&
      migration.includes('agent_probe_status_enabled'),
    'latest website monitor RPC migration must persist agent probe settings',
  ],
  [
    liveData.includes("this.broadcastMetadataChanged({ websites: true })"),
    'agent website probe persistence must refresh public website monitors',
  ],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('agent website public results check passed');
