import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dbFacade = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'queries.ts'), 'utf8');
const adminRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');
const providerSource = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'provider.ts'), 'utf8');
const supabaseClient = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'supabase-api', 'client.ts'), 'utf8');
const removedSettingsKey = 'SETTINGS_' + 'ENCRYPTION_KEY';

test('settings no longer use removed encryption secret or direct SQL helpers', () => {
  for (const source of [providerSource, dbFacade, adminRoutes, supabaseClient]) {
    assert.equal(source.includes(removedSettingsKey), false);
    assert.doesNotMatch(source, /settingsEncryptionKey|settings-crypto|encryptSetting|decryptSetting|canEncryptSettings|isEncryptedSettingValue|isSensitiveSettingKey|sensitivePlaintextKeys/);
    assert.doesNotMatch(source, /database\.sql|pg\./);
  }
});

test('settings reads, writes, and backup restore use Supabase RPC facade', () => {
  assert.match(dbFacade, /sba\.getSupabasePublicSettings\(database\.env\)/);
  assert.match(dbFacade, /sba\.setSupabaseSettings\(database\.env, settings\)/);
  assert.match(dbFacade, /sba\.restoreSupabaseBackupData\(database\.env, backup\)/);
  assert.match(supabaseClient, /cfm_set_settings/);
  assert.match(supabaseClient, /cfm_restore_backup_data/);
  assert.match(adminRoutes, /await db\.setSettings\(database, changedSettings\)/);
});
