import { readFileSync } from 'node:fs';

const checks = [
  ['supabase/migrations/20260615000000_core_schema.sql', 'agent_probe_mode'],
  ['supabase/migrations/20260615000000_core_schema.sql', 'source_client'],
  ['worker/src/routes/client.ts', 'website_probe_tasks'],
  ['worker/src/do/live-data.ts', 'website_probe_results'],
  ['worker/src/do/live-data.ts', "source_type: 'agent'"],
  ['worker/src/do/live-data.ts', 'agent_policy_website_probe_tasks'],
  ['worker/src/do/live-data.ts', 'policy sent without website probes'],
  ['worker/src/db/queries.ts', 'listAgentWebsiteProbeTasks'],
  ['agent/main.go', 'WebsiteProbeResults'],
  ['frontend/src/pages/admin/Websites.tsx', 'agent_probe_mode'],
];

let failed = false;
for (const [file, needle] of checks) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(needle)) {
    console.error(`${file} is missing ${needle}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('agent website probes check passed');
