import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const providerSource = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'provider.ts'), 'utf8');
const removedDatabaseProxy = String.fromCharCode(104, 121, 112, 101, 114, 100, 114, 105, 118, 101);

test('database provider is Supabase HTTP API only', () => {
  const legacyBinding = 'D' + '1';
  const legacyDatabaseList = 'd' + '1' + '_databases';
  assert.match(providerSource, /export type DatabaseProvider = 'supabase-api'/);
  assert.match(providerSource, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  assert.doesNotMatch(providerSource, /DATABASE_URL/);
  assert.doesNotMatch(providerSource, /POSTGRES_/);
  assert.doesNotMatch(providerSource, /ensurePostgres|getPostgres|postgresReady|schema-bootstrap/);
  assert.doesNotMatch(providerSource, new RegExp(`\\b${legacyBinding}\\b|${legacyBinding}Database|${legacyDatabaseList}|${removedDatabaseProxy}`, 'i'));
});

test('database configuration errors redact secret-looking messages at construction', () => {
  assert.match(providerSource, /import \{ redactDatabaseSecrets \} from '\.\.\/utils\/setup-diagnostics'/);
  assert.match(providerSource, /super\(redactDatabaseSecrets\(message\)\)/);
});
