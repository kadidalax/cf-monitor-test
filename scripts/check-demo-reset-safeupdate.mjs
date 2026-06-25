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

function latestFunction(name) {
  const matches = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend;\\n\\$\\$;`, 'gi'));
  assert.ok(matches?.length, `${name} function must exist`);
  return matches.at(-1);
}

const restoreBackup = latestFunction('cfm_restore_backup_data');
const restoreDemo = latestFunction('cfm_restore_demo_snapshot');
const resetAdmin = latestFunction('cfm_reset_admin_users');
const clearAllRecords = latestFunction('cfm_clear_all_records');

assert.doesNotMatch(source, /safeupdate\.enabled/i, 'migrations must not set safeupdate.enabled');
assert.match(clearAllRecords, /delete from records\s+where true\s+returning 1/i, 'clear records must safely clear records');
assert.match(restoreBackup, /delete from ping_tasks\s+where true;/i, 'backup restore must safely clear ping_tasks');
assert.match(restoreBackup, /delete from offline_notifications\s+where true;/i, 'backup restore must safely clear offline_notifications');
assert.match(restoreBackup, /delete from expiry_notifications\s+where true;/i, 'backup restore must safely clear expiry_notifications');
assert.match(restoreBackup, /delete from load_notifications\s+where true;/i, 'backup restore must safely clear load_notifications');
assert.match(restoreDemo, /delete from website_monitors\s+where true;/i, 'demo restore must safely clear website_monitors');
assert.match(resetAdmin, /delete from login_rate_limits\s+where true;/i, 'admin reset must safely clear login_rate_limits');
assert.match(resetAdmin, /delete from users\s+where true;/i, 'admin reset must safely clear users');
assert.match(source, /cfm_restore_demo_snapshot/, 'generated migrations must include the demo restore RPC');
assert.match(source, /cfm_reset_admin_users/, 'generated migrations must include the admin reset RPC');

console.log('demo reset safeupdate check passed');
