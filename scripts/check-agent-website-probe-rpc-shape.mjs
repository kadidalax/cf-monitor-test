import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/4_rpc_api.sql', 'utf8');
const fn = migration.match(/create or replace function public\.cfm_agent_website_probe_tasks[\s\S]*?\n\$\$;/i)?.[0] || '';

assert.ok(fn, 'cfm_agent_website_probe_tasks migration must exist');
assert.doesNotMatch(fn, /select\s+wm\.\*/i, 'agent website probe RPC must not union wm.* with explicit columns');
assert.match(fn, /select id, name, url, method, expected_status_min, expected_status_max, interval_sec,/i, 'agent website probe RPC must select a stable column list');

console.log('agent website probe RPC shape check passed');
