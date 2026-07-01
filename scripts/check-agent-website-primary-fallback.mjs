import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260701010000_agent_website_primary_fallback.sql', 'utf8');

const checks = [
  'create or replace function public.cfm_due_website_monitors',
  'agent_probe_status_enabled',
  "source_type = 'agent'",
  'recent_agent_success',
  "effective_status = 'up'",
  "source_kind = 'agent' and (monitor_row.agent_probe_status_enabled = false or check_ok = false)",
  'notify pgrst',
];

let failed = false;
for (const needle of checks) {
  if (!migration.includes(needle)) {
    console.error(`agent website primary fallback migration is missing ${needle}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('agent website primary fallback check passed');
