import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { SETTING_KEYS } from '../src/settings/schema.ts';
import {
  BACKUP_IV_BYTES,
  BACKUP_KDF_ITERATIONS,
  BACKUP_SALT_BYTES,
  decryptBackup,
  encryptBackup,
  MIN_BACKUP_DECRYPT_PASSWORD_BYTES,
  MIN_BACKUP_ENCRYPT_PASSWORD_BYTES,
  validateBackup,
} from '../src/utils/backup.ts';

const adminSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');
const backupSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'backup.ts'), 'utf8');
const dbFacade = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'queries.ts'), 'utf8');
const supabaseClient = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'supabase-api', 'client.ts'), 'utf8');

test('backup restore goes through the Supabase RPC facade', () => {
  assert.match(dbFacade, /restoreBackupData\(database: QueryDatabase, backup: BackupData\): Promise<void>/);
  assert.match(dbFacade, /sba\.restoreSupabaseBackupData\(database\.env, backup\)/);
  assert.match(supabaseClient, /cfm_restore_backup_data/);
  assert.doesNotMatch(dbFacade, /database\.sql|pg\./);
});

test('managed setting keys exclude internal schema and health keys', () => {
  assert.equal(SETTING_KEYS.includes('schema_bootstrap_version' as never), false);
  assert.equal(SETTING_KEYS.some(key => key.startsWith('health:')), false);
});

test('backup restore RPC is expected to preserve ping history by id', () => {
  const migration = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations', '20260625000000_supabase_only_rpc.sql'), 'utf8');
  assert.match(migration, /create or replace function public\.cfm_restore_backup_data\(input_backup jsonb\)/);
  assert.match(migration, /delete from ping_tasks where not \(id = any\(task_ids\)\)/);
  assert.match(migration, /on conflict \(id\) do update set/);
});

test('backup validation restores only configuration modules', () => {
  assert.match(backupSource, /type BackupModuleKey =[\s\S]*'settings'[\s\S]*'load_notifications'/);
  for (const excluded of ['records', 'gpu_records', 'gpu_snapshots', 'ping_records', 'ping_snapshots', 'audit_logs', 'users']) {
    assert.match(backupSource, new RegExp(`'${excluded}'`), `${excluded} should be listed as excluded`);
    assert.doesNotMatch(backupSource, new RegExp(`\\| '${excluded}'`), `${excluded} should not be restorable`);
  }
  assert.match(backupSource, /sanitizeSettingsForStorage\(input\.settings\)/);
  assert.match(backupSource, /validatePingTaskInput\(candidate\)/);
});

test('backup upload route requires encrypted backup before validation or restore', () => {
  const block = adminSource.slice(
    adminSource.indexOf("adminRoutes.post('/upload/backup'"),
    adminSource.indexOf('\n// 获取审计日志'),
  );
  const encryptedCheck = block.indexOf('if (!isEncryptedBackupEnvelope(encryptedBackup))');
  const decrypt = block.indexOf('const decrypted = await decryptBackup(encryptedBackup, backupPassword)');
  const validate = block.indexOf('const validated = validateBackup(backupInput)');
  const restore = block.indexOf('await db.restoreBackupData(database, validated.backup)');

  assert.notEqual(encryptedCheck, -1);
  assert.match(block, /只支持导入加密完整备份，不支持明文备份文件/);
  assert.ok(encryptedCheck < decrypt);
  assert.ok(decrypt < validate);
  assert.ok(validate < restore);
});

test('encrypted backup downloads are explicitly non-cacheable', () => {
  const block = adminSource.slice(
    adminSource.indexOf("adminRoutes.post('/download/backup'"),
    adminSource.indexOf('\n// 上传备份恢复'),
  );
  assert.match(block, /'Cache-Control': 'no-store'/);
  assert.match(block, /'X-CF-VPS-Monitor-Backup-Encrypted': 'true'/);
});

test('backup download failures are logged instead of silently swallowed', () => {
  const block = adminSource.slice(
    adminSource.indexOf("adminRoutes.post('/download/backup'"),
    adminSource.indexOf('\n// 上传备份恢复'),
  );
  assert.match(block, /catch\s*\(\s*error\s*\)/);
  assert.match(block, /console\.error\('\[backup\] download failed:',\s*sanitizeSetupDiagnosticDetail\(error\)\)/);
});

test('encrypted backups reject malformed encryption parameters before restore', async () => {
  const password = 'Backup-password-16+';
  const validated = validateBackup({
    version: '2.0.0',
    settings: { site_title: 'CF VPS Monitor' },
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const encrypted = await encryptBackup(validated.backup, password);
  assert.equal(encrypted.ok, true);
  if (!encrypted.ok) return;

  assert.equal(atob(encrypted.encryptedBackup.encryption.salt).length, BACKUP_SALT_BYTES);
  assert.equal(atob(encrypted.encryptedBackup.encryption.iv).length, BACKUP_IV_BYTES);
  assert.ok(atob(encrypted.encryptedBackup.ciphertext).length > 0);
  assert.equal((await decryptBackup(encrypted.encryptedBackup, password)).ok, true);

  for (const tampered of [
    { encryption: { salt: btoa('short') } },
    { encryption: { iv: btoa('short') } },
    { ciphertext: '' },
  ]) {
    const broken = {
      ...encrypted.encryptedBackup,
      ...tampered,
      encryption: {
        ...encrypted.encryptedBackup.encryption,
        ...(tampered as any).encryption,
      },
    };
    assert.deepEqual(await decryptBackup(broken, password), {
      ok: false,
      error: '加密备份编码无效',
    });
  }
});

test('backup passwords require only six characters', async () => {
  const validated = validateBackup({
    version: '2.0.0',
    settings: { site_title: 'CF VPS Monitor' },
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  assert.equal(MIN_BACKUP_ENCRYPT_PASSWORD_BYTES, 6);
  assert.equal(MIN_BACKUP_DECRYPT_PASSWORD_BYTES, 6);
  assert.deepEqual(await encryptBackup(validated.backup, '12345'), {
    ok: false,
    error: '备份密码至少需要 6 位',
  });

  const encrypted = await encryptBackup(validated.backup, '123456');
  assert.equal(encrypted.ok, true);
  if (!encrypted.ok) return;
  const wrongPassword = await decryptBackup(encrypted.encryptedBackup, '654321');
  assert.equal(wrongPassword.ok, false);
  if (!wrongPassword.ok) {
    assert.equal(wrongPassword.error, '备份密码错误或文件已损坏');
  }
});

test('new encrypted backups use a Cloudflare Workers supported PBKDF2 cost', async () => {
  assert.equal(BACKUP_KDF_ITERATIONS, 100_000);

  const validated = validateBackup({
    version: '2.0.0',
    settings: { site_title: 'CF VPS Monitor' },
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const encrypted = await encryptBackup(validated.backup, '123456');
  assert.equal(encrypted.ok, true);
  if (!encrypted.ok) return;
  assert.equal(encrypted.encryptedBackup.encryption.iterations, 100_000);
});
