import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
const base = [
  '20260615000000_core_schema.sql',
  '20260615010000_security_access.sql',
  '20260618000000_feature_schema.sql',
  '20260622000000_rpc_api.sql',
  '20260703000000_runtime_defaults.sql',
];
const expected = files.includes('20260626000000_demo_reset.sql')
  ? [...base, '20260626000000_demo_reset.sql'].sort()
  : base;

assert.deepEqual(files, expected, 'Supabase migrations must stay grouped by category');

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8');
  assert.doesNotMatch(sql, /^\s*begin\s*;\s*$/im, `${file} must not contain nested begin;`);
  assert.doesNotMatch(sql, /^\s*commit\s*;\s*$/im, `${file} must not contain nested commit;`);
}

const generated = readFileSync('worker/src/generated/supabase-migrations.ts', 'utf8');
for (const file of expected) {
  assert.match(generated, new RegExp(`"version": "${file.replace(/\.sql$/, '')}"`), `${file} must be bundled`);
}

console.log('supabase grouped migrations check passed');
