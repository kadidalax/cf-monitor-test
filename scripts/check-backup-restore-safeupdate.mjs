import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const migrationsDir = 'supabase/migrations';
const source = readdirSync(migrationsDir)
  .filter(file => file.endsWith('.sql'))
  .sort()
  .map(file => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');

function functionBody(name) {
  const matches = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend;\\n\\$\\$;`, 'gi'));
  assert.ok(matches?.length, `${name} function must exist`);
  return matches.at(-1);
}

const restoreBackup = functionBody('cfm_restore_backup_data');

assert.match(
  source.slice(source.lastIndexOf(restoreBackup)),
  /set_config\('safeupdate\.enabled',\s*'0',\s*true\)|alter function public\.cfm_restore_backup_data\(jsonb\)\s+set safeupdate\.enabled\s*=\s*'0'/i,
  'backup restore must disable pg-safeupdate for the restore transaction',
);
assert.match(
  source,
  /revoke all on function public\.cfm_restore_backup_data\(jsonb\) from public;/i,
  'backup restore RPC must stay revoked from public',
);
assert.match(
  source,
  /grant execute on function public\.cfm_restore_backup_data\(jsonb\) to service_role;/i,
  'backup restore RPC must only be exposed to service_role',
);

console.log('backup restore safeupdate check passed');
