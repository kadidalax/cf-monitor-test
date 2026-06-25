import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('worker/src/generated/supabase-migrations.ts', 'utf8');

assert.match(source, /allow_demo_reset_safeupdate/, 'generated migrations must include the demo reset safety fix');
assert.match(source, /safeupdate\.enabled/, 'generated migrations must disable safeupdate for demo reset RPCs');
assert.match(source, /cfm_restore_demo_snapshot/, 'generated migrations must include the demo restore RPC');
assert.match(source, /cfm_reset_admin_users/, 'generated migrations must include the admin reset RPC');

console.log('demo reset safeupdate check passed');
