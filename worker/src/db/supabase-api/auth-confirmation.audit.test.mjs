import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, applyApplicationMigrations, rpc } from '../../../../scripts/test-support/postgres.mjs';

test('W05/SEC01/SEC02: SQL confirmation, credential CAS and role boundaries', async t => {
  const sql = await createTestDatabase();
  t.after(() => sql.close());
  const legacyHash = 'a'.repeat(43), versionedHash = `v2.${'b'.repeat(16)}.${'c'.repeat(43)}`;
  const args = { input_uuid: 'confirmation-owner', input_session_version: 1,
    input_operation_id: '1'.repeat(64), input_factor_key: '2'.repeat(64), input_method: 'totp', input_step: 123 };
  const consume = extra => sql.transaction(async tx => {
    await tx.exec('set local role service_role');
    return rpc(tx, 'cfm_consume_mfa_factor', { ...args, ...extra });
  });
  t.beforeEach(async () => {
    await sql.exec('delete from users');
    await sql.query('insert into users(uuid,username,passwd,session_version,totp_secret_enc,totp_enabled_at,recovery_code_hashes,totp_last_used_step) values($1,$1,$2,1,$3,now(),$4::jsonb,-1)',
      [args.input_uuid, 'synthetic-old-password-hash', 'v1.synthetic-encrypted-fixture', JSON.stringify([legacyHash, versionedHash])]);
  });
  await t.test('confirmation is a durable operation result and does not consume the same TOTP twice', async () => {
    const first = await consume();
    assert.equal(first.verified, true);
    const second = await consume();
    assert.equal(second.verified, true); assert.equal(second.verified_at, first.verified_at);
    assert.equal((await consume({ input_step: null })).verified, true, 'an expired OTP can resume its existing confirmation but cannot start a new one');
    assert.equal((await sql.query("select count(*)::int as count from audit_logs where action='mfa_factor_confirmed'")).rows[0].count, 1);
    assert.equal((await consume({ input_operation_id: '3'.repeat(64) })).verified, false);
    assert.equal((await consume({ input_factor_key: '4'.repeat(64), input_step: 124 })).verified, false);
  });
  await t.test('MFA business changes and their audit events commit together', async () => {
    await sql.exec('delete from audit_logs');
    await rpc(sql, 'cfm_enable_user_totp', { input_uuid: args.input_uuid, input_secret_enc: 'v1.synthetic-next-encrypted-fixture',
      input_recovery_code_hashes: Array(8).fill(legacyHash), input_used_step: 1 });
    await rpc(sql, 'cfm_replace_user_recovery_codes', { input_uuid: args.input_uuid, input_recovery_code_hashes: Array(8).fill(versionedHash) });
    await rpc(sql, 'cfm_disable_user_totp', { input_uuid: args.input_uuid });
    const actions = (await sql.query("select action from audit_logs where action like 'mfa_%' order by id")).rows.map(row => row.action);
    assert.deepEqual(actions, ['mfa_enabled', 'mfa_recovery_codes_regenerated', 'mfa_disabled']);
  });
  await t.test('audit storage failure rolls back consumption and MFA business changes', async () => {
    await sql.exec('revoke insert on public.audit_logs from service_role');
    try {
      await assert.rejects(consume, error => error.code === '42501');
      assert.equal(Number((await sql.query('select totp_last_used_step from users')).rows[0].totp_last_used_step), -1);
      assert.equal((await sql.query('select count(*)::int as count from cfm_internal.mfa_factor_receipts')).rows[0].count, 0);
      await assert.rejects(() => sql.transaction(async tx => {
        await tx.exec('set local role service_role');
        await rpc(tx, 'cfm_disable_user_totp', { input_uuid: args.input_uuid });
      }), error => error.code === '42501');
      const account = (await sql.query('select totp_enabled_at,session_version from users')).rows[0];
      assert.ok(account.totp_enabled_at); assert.equal(account.session_version, 1);
    } finally { await sql.exec('grant insert on public.audit_logs to service_role'); }
  });
  for (const hash of [legacyHash, versionedHash]) await t.test(`recovery format ${hash.startsWith('v2.') ? 'v2' : 'legacy'} has the same retry boundary`, async () => {
    const input = { input_method: 'recovery_code', input_step: null, input_code_hashes: [hash] };
    assert.equal((await consume(input)).verified, true);
    assert.equal((await consume(input)).verified, true);
    assert.equal((await consume({ ...input, input_operation_id: '5'.repeat(64) })).verified, false);
    const row = (await sql.query('select jsonb_array_length(recovery_code_hashes)::int as count from users')).rows[0];
    assert.equal(row.count, 1);
  });
  await t.test('session revocation and expiration invalidate a persisted confirmation', async () => {
    assert.equal((await consume()).verified, true);
    await sql.exec('update users set session_version=2');
    assert.equal((await consume()).verified, false);
    await sql.exec('update users set session_version=1');
    await sql.exec("update cfm_internal.mfa_factor_receipts set expires_at=now()-interval '1 second'");
    assert.equal((await consume()).verified, false);
  });
  await t.test('password rehash compares the original hash and never rotates sessions', async () => {
    const update = value => rpc(sql, 'cfm_rehash_user_password', { input_uuid: args.input_uuid,
      input_expected_passwd: 'synthetic-old-password-hash', input_passwd: value });
    assert.equal(await update('synthetic-new-password-hash'), true);
    assert.equal(await update('synthetic-stale-rehash'), false);
    const row = (await sql.query('select passwd,session_version from users')).rows[0];
    assert.equal(row.passwd === 'synthetic-new-password-hash', true); assert.equal(row.session_version, 1);
  });
  await t.test('TOTP ciphertext migration compares its original value without changing the factor state', async () => {
    const ciphertext = `v2.${'a'.repeat(16)}.synthetic.iv`;
    const input = { input_uuid: args.input_uuid, input_expected_secret: 'v1.synthetic-encrypted-fixture', input_secret_enc: ciphertext };
    assert.equal(await rpc(sql, 'cfm_reencrypt_totp_secret', input), true);
    assert.equal(await rpc(sql, 'cfm_reencrypt_totp_secret', input), false);
    const row = (await sql.query('select session_version,totp_last_used_step from users')).rows[0];
    assert.equal(row.session_version, 1); assert.equal(Number(row.totp_last_used_step), -1);
  });
  await t.test('fresh installation and replay keep security functions service-only and receipts persistent', async () => {
    assert.equal((await consume()).verified, true);
    await applyApplicationMigrations(sql);
    assert.equal((await consume()).verified, true);
    for (const role of ['anon', 'authenticated']) {
      const privileges = (await sql.query(`select bool_or(has_function_privilege($1,p.oid,'execute')) as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cfm_consume_mfa_factor','cfm_rehash_user_password','cfm_reencrypt_totp_secret')`, [role])).rows[0];
      assert.equal(privileges.allowed, false);
      assert.equal((await sql.query("select has_table_privilege($1,'cfm_internal.mfa_factor_receipts','select,insert,update,delete') as allowed", [role])).rows[0].allowed, false);
    }
    assert.equal((await sql.query("select relrowsecurity and relforcerowsecurity as protected from pg_class where oid='cfm_internal.mfa_factor_receipts'::regclass")).rows[0].protected, true);
  });
});
