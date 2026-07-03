import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260622000000_rpc_api.sql', 'utf8');
const websiteAdmin = readFileSync('frontend/src/pages/admin/Websites.tsx', 'utf8');

const checks = [
  'create or replace function public.cfm_due_website_monitors',
  'agent_probe_status_enabled',
  "source_type = 'agent'",
  'recent_agent_success',
  "effective_status = 'up'",
  'wm.agent_probe_status_enabled = true',
  "source_kind = 'agent' and monitor_row.agent_probe_status_enabled = true and check_ok = false",
  "alter table website_monitors alter column agent_probe_mode set default 'country_auto'",
  'alter table website_monitors alter column agent_probe_status_enabled set default true',
  "update website_monitors",
  'notify pgrst',
];

let failed = false;
for (const needle of checks) {
  if (!migration.includes(needle)) {
    console.error(`agent website primary fallback migration is missing ${needle}`);
    failed = true;
  }
}

for (const needle of ["agent_probe_mode: 'country_auto' as WebsiteAgentProbeMode", 'agent_probe_status_enabled: true', 'CF 兜底']) {
  if (!websiteAdmin.includes(needle)) {
    console.error(`admin website form is missing ${needle}`);
    failed = true;
  }
}

const validator = readFileSync('worker/src/utils/website-monitor.ts', 'utf8');
if (!validator.includes("agent_probe_status_enabled: typeof input.agent_probe_status_enabled === 'boolean' ? input.agent_probe_status_enabled : true")) {
  console.error('website monitor validator does not default CF fallback on');
  failed = true;
}

if (failed) process.exit(1);
console.log('agent website primary fallback check passed');
